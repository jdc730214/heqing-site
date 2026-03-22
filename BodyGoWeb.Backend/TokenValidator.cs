using System.IdentityModel.Tokens.Jwt;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace BodyGoWeb_Backend
{
    public static class TokenValidator
    {
        private static readonly string _tenantId = "f03d3251-bf23-4521-b7cd-15ebfa0cd086";
        private static readonly string _clientId = "ff727949-37ca-44ae-a461-d06be688e8e1";
        private static readonly string _authority = $"https://bodygocustomers.ciamlogin.com/{_tenantId}/v2.0";

        public static async Task<JwtSecurityToken> ValidateTokenAsync(string token)
        {
            var configurationManager = new ConfigurationManager<OpenIdConnectConfiguration>(
                $"{_authority}/.well-known/openid-configuration",
                new OpenIdConnectConfigurationRetriever());

            var config = await configurationManager.GetConfigurationAsync();

            var validationParameters = new TokenValidationParameters
            {
                ValidateAudience = true,
                ValidAudience = _clientId,
                ValidateIssuer = true,
                ValidIssuer = config.Issuer,
                IssuerSigningKeys = config.SigningKeys,
                ValidateLifetime = true // 檢查 Token 是否過期
            };

            var handler = new JwtSecurityTokenHandler();
            var principal = handler.ValidateToken(token, validationParameters, out var validatedToken);

            return (JwtSecurityToken)validatedToken;
        }
    }
}