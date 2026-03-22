using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Data.SqlClient;
using Dapper;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;

namespace BodyGoWeb_Backend
{
    public class DeductPoints
    {
        private readonly ILogger<DeductPoints> _logger;

        public DeductPoints(ILogger<DeductPoints> logger)
        {
            _logger = logger;
        }

        [Function("DeductPoints")]
        public async Task<IActionResult> Run([HttpTrigger(AuthorizationLevel.Anonymous, "post")] HttpRequest req)
        {
            _logger.LogInformation(">>> 接收到扣點請求，啟動安全驗證與事務處理...");

            // 1. 安全驗證：取得並驗證 Token
            string authHeader = req.Headers["Authorization"];
            if (string.IsNullOrEmpty(authHeader) || !authHeader.StartsWith("Bearer "))
            {
                return new UnauthorizedResult();
            }

            string token = authHeader.Substring(7);
            string userOid;

            try
            {
                // 使用我們剛才建立的專業驗證器
                var validatedToken = await TokenValidator.ValidateTokenAsync(token);
                userOid = validatedToken.Claims.First(c => c.Type == "sub").Value;
            }
            catch (Exception ex)
            {
                _logger.LogWarning($"!!! Token 驗證失敗: {ex.Message}");
                return new UnauthorizedObjectResult(new { error = "AUTH_FAILED", message = "無效的身分憑證" });
            }

            // 2. 資料庫操作：使用 Transaction 確保資料完整性
            string connectionString = Environment.GetEnvironmentVariable("SqlConnectionString");

            try
            {
                using (var connection = new SqlConnection(connectionString))
                {
                    await connection.OpenAsync();
                    using (var transaction = connection.BeginTransaction())
                    {
                        // 檢查點數並扣除 (假設每次量測扣 10 點)
                        string updateSql = @"
                            UPDATE Users 
                            SET PointsBalance = PointsBalance - 10, UpdatedAt = GETDATE()
                            WHERE UserOID = @oid AND PointsBalance >= 10";

                        int affectedRows = await connection.ExecuteAsync(updateSql, new { oid = userOid }, transaction);

                        if (affectedRows == 0)
                        {
                            transaction.Rollback();
                            return new BadRequestObjectResult(new { error = "INSUFFICIENT_POINTS", message = "點數不足或用戶不存在" });
                        }

                        // 寫入交易流水紀錄
                        string logSql = @"
                            INSERT INTO Transactions (UserOID, Amount, Reason, CreatedAt) 
                            VALUES (@oid, -10, 'BodyGo_Measurement', GETDATE())";

                        await connection.ExecuteAsync(logSql, new { oid = userOid }, transaction);

                        // 全部成功才提交
                        transaction.Commit();
                        _logger.LogInformation($">>> 用戶 {userOid} 扣點成功 (-10)");

                        return new OkObjectResult(new { status = "SUCCESS", deducted = 10 });
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError($"!!! 資料庫交易異常: {ex.Message}");
                return new ObjectResult(new { error = "DATABASE_ERROR", message = "系統忙碌中，請稍後再試" }) { StatusCode = 500 };
            }
        }
    }
}