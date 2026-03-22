using System;
using System.Linq;
using System.Threading.Tasks;
using System.IdentityModel.Tokens.Jwt; // 需安裝：dotnet add package System.IdentityModel.Tokens.Jwt
using Microsoft.Data.SqlClient;
using Dapper;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;

namespace BodyGoWeb_Backend
{
    public class GetUserPoints
    {
        private readonly ILogger<GetUserPoints> _logger;

        public GetUserPoints(ILogger<GetUserPoints> logger)
        {
            _logger = logger;
        }

        [Function("GetUserPoints")]
        public async Task<IActionResult> Run([HttpTrigger(AuthorizationLevel.Anonymous, "get")] HttpRequest req)
        {
            _logger.LogInformation(">>> 接收到點數查詢請求，啟動安全驗證流程...");

            // 1. 取得 Authorization Header
            string authHeader = req.Headers["Authorization"];
            if (string.IsNullOrEmpty(authHeader) || !authHeader.StartsWith("Bearer "))
            {
                _logger.LogWarning("!!! 拒絕請求: 缺少 Bearer Token");
                return new UnauthorizedResult();
            }

            string token = authHeader.Substring(7);

            try
            {
                // 2. [核心安全升級] 呼叫 TokenValidator 執行真正的 OIDC 驗證
                // 這會檢查：簽章是否正確、是否由 bodygocustomers 發行、是否過期
                var validatedToken = await TokenValidator.ValidateTokenAsync(token);

                // 從驗證後的 Token 中安全地提取資訊
                string userOid = validatedToken.Claims.First(c => c.Type == "sub").Value;
                string userEmail = validatedToken.Claims.FirstOrDefault(c => c.Type == "email")?.Value
                                 ?? validatedToken.Claims.FirstOrDefault(c => c.Type == "preferred_username")?.Value
                                 ?? "UnknownUser";

                _logger.LogInformation($">>> 驗證成功: 使用者 {userEmail} (ID: {userOid})");

                // 3. 取得資料庫連線字串
                string connectionString = Environment.GetEnvironmentVariable("SqlConnectionString");

                using (var connection = new SqlConnection(connectionString))
                {
                    // 4. 查詢 SQL 資料
                    var userRecord = await connection.QueryFirstOrDefaultAsync(
                        "SELECT UserOID, Email, PointsBalance FROM Users WHERE UserOID = @oid",
                        new { oid = userOid }
                    );

                    // 5. 自動註冊邏輯 (Data Binding)
                    if (userRecord == null)
                    {
                        _logger.LogInformation($">>> 偵測到新會員，自動建立紀錄: {userEmail}");
                        await connection.ExecuteAsync(
                            @"INSERT INTO Users (UserOID, Email, PointsBalance, CreatedAt, UpdatedAt) 
                      VALUES (@oid, @email, 100, GETDATE(), GETDATE())",
                            new { oid = userOid, email = userEmail }
                        );

                        return new OkObjectResult(new
                        {
                            UserOID = userOid,
                            Email = userEmail,
                            PointsBalance = 100,
                            status = "NEW_USER_CREATED"
                        });
                    }

                    return new OkObjectResult(userRecord);
                }
            }
            catch (SecurityTokenExpiredException)
            {
                _logger.LogWarning("!!! 驗證失敗: Token 已過期");
                return new UnauthorizedObjectResult(new { error = "TOKEN_EXPIRED", message = "請重新登入" });
            }
            catch (Exception ex)
            {
                // 錯誤會被紀錄到 Application Insights，方便線上排錯
                _logger.LogError($"!!! 系統異常: {ex.Message}");
                return new UnauthorizedObjectResult(new { error = "AUTH_FAILED", message = "無效的身分憑證" });
            }
        }
    }
}