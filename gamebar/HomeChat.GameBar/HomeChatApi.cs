using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;

namespace HomeChat.GameBar
{
    public sealed class HomeChatApi : IDisposable
    {
        private readonly HttpClient _http = new HttpClient();
        private string _baseUrl = string.Empty;
        private string _token = string.Empty;

        public string BaseUrl => _baseUrl;
        public string Token => _token;

        public void Configure(string baseUrl, string token = null)
        {
            _baseUrl = NormalizeBaseUrl(baseUrl);
            _token = token ?? string.Empty;
            _http.DefaultRequestHeaders.Authorization = string.IsNullOrWhiteSpace(_token)
                ? null
                : new AuthenticationHeaderValue("Bearer", _token);
        }

        public async Task<LoginResponse> LoginAsync(string baseUrl, string displayName, string password)
        {
            Configure(baseUrl);
            var payload = JsonConvert.SerializeObject(new { displayName, password });
            using (var response = await _http.PostAsync(
                _baseUrl + "/api/auth/login",
                new StringContent(payload, Encoding.UTF8, "application/json")))
            {
                await EnsureSuccess(response);
                var login = JsonConvert.DeserializeObject<LoginResponse>(await response.Content.ReadAsStringAsync());
                Configure(baseUrl, login.Token);
                return login;
            }
        }

        public async Task<List<Conversation>> GetConversationsAsync()
        {
            return await GetJsonAsync<List<Conversation>>("/api/conversations");
        }

        public async Task<List<Message>> GetMessagesAsync(int conversationId)
        {
            return await GetJsonAsync<List<Message>>("/api/conversations/" + conversationId + "/messages?limit=50");
        }

        public async Task<Message> SendMessageAsync(int conversationId, string body)
        {
            var payload = JsonConvert.SerializeObject(new
            {
                body,
                clientNonce = Guid.NewGuid().ToString("N")
            });

            using (var response = await _http.PostAsync(
                _baseUrl + "/api/conversations/" + conversationId + "/messages",
                new StringContent(payload, Encoding.UTF8, "application/json")))
            {
                await EnsureSuccess(response);
                return JsonConvert.DeserializeObject<Message>(await response.Content.ReadAsStringAsync());
            }
        }

        public async Task<User> GetMeAsync()
        {
            return await GetJsonAsync<User>("/api/me");
        }

        private async Task<T> GetJsonAsync<T>(string path)
        {
            using (var response = await _http.GetAsync(_baseUrl + path))
            {
                await EnsureSuccess(response);
                return JsonConvert.DeserializeObject<T>(await response.Content.ReadAsStringAsync());
            }
        }

        private static async Task EnsureSuccess(HttpResponseMessage response)
        {
            if (response.IsSuccessStatusCode) return;
            var detail = await response.Content.ReadAsStringAsync();
            throw new InvalidOperationException("HomeChat returned " + (int)response.StatusCode + ": " + detail);
        }

        private static string NormalizeBaseUrl(string value)
        {
            var normalized = (value ?? string.Empty).Trim().TrimEnd('/');
            if (normalized.Length == 0) throw new ArgumentException("Server address is required.");
            if (!normalized.StartsWith("https://", StringComparison.OrdinalIgnoreCase) &&
                !normalized.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
            {
                normalized = "https://" + normalized;
            }
            return normalized;
        }

        public void Dispose()
        {
            _http.Dispose();
        }
    }
}
