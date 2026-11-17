using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal sealed class ConnectorConfig
{
    public string Server { get; set; }
    public int Port { get; set; }
    public string User { get; set; }
    public string Password { get; set; }
    public string Database { get; set; }
    public string ApiToken { get; set; }
}

internal static class Program
{
    private const int ListenPort = 43128;
    private const string InstanceMutexName = @"Global\PulsitBISHistoryConnector";
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static readonly string Root = AppDomain.CurrentDomain.BaseDirectory;
    private static readonly string ConfigPath = Path.Combine(Root, "connection.dat");
    private static readonly string LogPath = Path.Combine(Root, "connector.log");
    private static readonly string AuditLogPath = Path.Combine(Root, "connector-audit.jsonl");
    private static readonly object JsonSync = new object();
    private static readonly object LogSync = new object();
    private const long MaximumLogBytes = 5L * 1024L * 1024L;

    private static int Main()
    {
        string phase = "instance_check";
        try
        {
            bool ownsMutex;
            using (var mutex = CreateInstanceMutex(InstanceMutexName, out ownsMutex))
            {
                if (!ownsMutex)
                {
                    const string message = "Another BIS History Connector instance has already reserved the connector on this server. "
                        + "No additional instance was started. Check the existing BISHistoryConnector.Live.exe process in Task Manager.";
                    Log(message);
                    LogAudit("startup_already_running", null, null, null, null, null, null, null, 0, phase, null);
                    ShowStartupMessage(message);
                    return 0;
                }
                try
                {
                    phase = "configuration";
                    ConnectorConfig config = LoadConfig();
                    phase = "sql_connection";
                    TestConnection(config);
                    using (var listener = new HttpListener())
                    {
                        phase = "listener_start";
                        listener.Prefixes.Add("http://127.0.0.1:" + ListenPort + "/");
                        listener.Start();
                        Log("Started read-only connector on 127.0.0.1:" + ListenPort + ".");
                        phase = "listener_accept";
                        while (listener.IsListening)
                        {
                            try
                            {
                                var context = listener.GetContext();
                                ThreadPool.QueueUserWorkItem(delegate
                                {
                                    try { HandleRequest(context, config); }
                                    catch (Exception ex)
                                    {
                                        Log("Unhandled request failure: " + SafeMessage(ex));
                                        LogAudit("unhandled_request_failure", null, null, null, null, null, null, null, 0, "request_handler", ex);
                                    }
                                });
                            }
                            catch (HttpListenerException ex)
                            {
                                Log("Listener stopped: " + SafeMessage(ex));
                                LogAudit("listener_stopped", null, null, null, null, null, null, null, 0, "listener_accept", ex);
                                break;
                            }
                            catch (ObjectDisposedException ex)
                            {
                                Log("Listener disposed.");
                                LogAudit("listener_stopped", null, null, null, null, null, null, null, 0, "listener_accept", ex);
                                break;
                            }
                        }
                    }
                    return 0;
                }
                finally { mutex.ReleaseMutex(); }
            }
        }
        catch (Exception ex)
        {
            string message = phase == "instance_check" && ex is UnauthorizedAccessException
                ? "Startup blocked: Windows denied access to the connector's machine-wide instance lock (" + InstanceMutexName + "). "
                    + "Another instance may be running under a different Windows account. "
                    + "No additional instance was started. Check BISHistoryConnector.Live.exe in Task Manager on this server."
                : "Stopped during " + phase + ": " + SafeMessage(ex);
            if (phase == "configuration")
                message += " Check that connection.dat exists alongside this executable and was encrypted for this server.";
            Log(message);
            LogAudit("startup_failed", null, null, null, null, null, null, null, 0, phase, ex);
            ShowStartupMessage(message);
            return 2;
        }
    }

    private static Mutex CreateInstanceMutex(string name, out bool ownsMutex)
    {
        // Checking existence needs only Synchronize; it does not request Modify access
        // to a lock owned by another Windows account or session.
        try
        {
            using (Mutex.OpenExisting(name, MutexRights.Synchronize))
            {
                ownsMutex = false;
                return null;
            }
        }
        catch (WaitHandleCannotBeOpenedException) { }

        // Keep creation atomic so simultaneous launches cannot start two connectors.
        return new Mutex(true, name, out ownsMutex);
    }

    private static void ShowStartupMessage(string message)
    {
        try
        {
            Console.Error.WriteLine(message);
            if (Environment.UserInteractive && !Console.IsInputRedirected)
            {
                Console.Error.WriteLine("Press any key to close this window.");
                Console.ReadKey(true);
            }
        }
        catch { }
    }

    private static ConnectorConfig LoadConfig()
    {
        if (!File.Exists(ConfigPath)) throw new InvalidOperationException("Encrypted configuration is missing.");
        byte[] encrypted = File.ReadAllBytes(ConfigPath);
        byte[] plain = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.LocalMachine);
        try
        {
            var config = Json.Deserialize<ConnectorConfig>(Encoding.UTF8.GetString(plain));
            if (config == null || string.IsNullOrWhiteSpace(config.Server) || config.Port < 1
                || string.IsNullOrWhiteSpace(config.User) || string.IsNullOrWhiteSpace(config.Password)
                || string.IsNullOrWhiteSpace(config.Database) || string.IsNullOrWhiteSpace(config.ApiToken))
                throw new InvalidOperationException("Encrypted configuration is invalid.");
            return config;
        }
        finally { Array.Clear(plain, 0, plain.Length); }
    }

    private static string ConnectionString(ConnectorConfig config)
    {
        return new SqlConnectionStringBuilder {
            DataSource = config.Server + "," + config.Port,
            InitialCatalog = config.Database,
            UserID = config.User,
            Password = config.Password,
            IntegratedSecurity = false,
            ApplicationName = "Pulsit BIS History Connector ReadOnly",
            ApplicationIntent = ApplicationIntent.ReadOnly,
            ConnectTimeout = 15,
            Encrypt = false,
            TrustServerCertificate = true,
            MultipleActiveResultSets = false,
            Pooling = true,
            MaxPoolSize = 4
        }.ConnectionString;
    }

    private static void TestConnection(ConnectorConfig config)
    {
        using (var connection = new SqlConnection(ConnectionString(config)))
        using (var command = new SqlCommand("SELECT TOP (1) 1 FROM [dbo].[UnitHistory] WITH (NOLOCK);", connection))
        {
            command.CommandTimeout = 15;
            connection.Open();
            command.ExecuteScalar();
        }
    }

    private static void HandleRequest(HttpListenerContext context, ConnectorConfig config)
    {
        string requestId = Guid.NewGuid().ToString("N");
        string path = null;
        string registration = null;
        DateTime? startUtc = null;
        DateTime? endUtc = null;
        int? responseStatus = null;
        int? rowCount = null;
        string phase = "request_received";
        bool completed = false;
        var stopwatch = Stopwatch.StartNew();
        try
        {
            path = context.Request.Url == null ? null : context.Request.Url.AbsolutePath.TrimEnd('/').ToLowerInvariant();
            LogAudit("request_started", requestId, path, null, null, null, null, null, stopwatch.ElapsedMilliseconds, phase, null);
            context.Response.Headers["Cache-Control"] = "no-store";
            if (context.Request.HttpMethod != "GET") { responseStatus = 405; phase = "response_write"; WriteJson(context, responseStatus.Value, new { error = "method_not_allowed" }); completed = true; return; }
            if (path == "" || path == "/health") { responseStatus = 200; phase = "response_write"; WriteJson(context, responseStatus.Value, new { ok = true, mode = "read-only" }); completed = true; return; }
            if (path != "/history") { responseStatus = 404; phase = "response_write"; WriteJson(context, responseStatus.Value, new { error = "not_found" }); completed = true; return; }
            if (!ConstantTimeEquals(context.Request.Headers["X-BIS-Token"], config.ApiToken))
            { responseStatus = 401; phase = "response_write"; WriteJson(context, responseStatus.Value, new { error = "unauthorized" }); completed = true; return; }

            registration = (context.Request.QueryString["registration"] ?? "").Trim();
            DateTimeOffset start, end;
            if (registration.Length == 0 || registration.Length > 100
                || !DateTimeOffset.TryParse(context.Request.QueryString["start"], CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out start)
                || !DateTimeOffset.TryParse(context.Request.QueryString["end"], CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out end)
                || end <= start || end - start > TimeSpan.FromDays(31))
            { responseStatus = 422; phase = "response_write"; WriteJson(context, responseStatus.Value, new { error = "invalid_parameters" }); completed = true; return; }

            startUtc = start.UtcDateTime;
            endUtc = end.UtcDateTime;
            phase = "sql_query";
            LogAudit("query_started", requestId, path, registration, startUtc, endUtc, null, null, stopwatch.ElapsedMilliseconds, phase, null);
            int queryRowCount;
            object result = QueryHistory(config, registration, startUtc.Value, endUtc.Value, out queryRowCount);
            rowCount = queryRowCount;
            LogAudit("query_completed", requestId, path, registration, startUtc, endUtc, null, rowCount, stopwatch.ElapsedMilliseconds, phase, null);
            responseStatus = 200;
            phase = "response_write";
            WriteJson(context, responseStatus.Value, result);
            completed = true;
        }
        catch (Exception ex)
        {
            if (IsClientDisconnect(ex, phase))
            {
                Log("Request " + requestId + " client disconnected during " + phase + ".");
                LogAudit("client_disconnected", requestId, path, registration, startUtc, endUtc, responseStatus, rowCount, stopwatch.ElapsedMilliseconds, phase, ex);
                return;
            }

            string eventName = ex is SqlException ? "sql_query_failed" : "request_failed";
            Log("Request " + requestId + " failed during " + phase + ": " + SafeMessage(ex));
            LogAudit(eventName, requestId, path, registration, startUtc, endUtc, responseStatus, rowCount, stopwatch.ElapsedMilliseconds, phase, ex);
            responseStatus = 500;
            phase = "error_response_write";
            try
            {
                WriteJson(context, responseStatus.Value, new { error = ex is SqlException ? "query_failed" : "request_failed", request_id = requestId, message = SafeMessage(ex) });
            }
            catch (Exception responseException)
            {
                Log("Request " + requestId + " could not send the error response: " + SafeMessage(responseException));
                LogAudit("error_response_failed", requestId, path, registration, startUtc, endUtc, responseStatus, rowCount, stopwatch.ElapsedMilliseconds, phase, responseException);
            }
        }
        finally
        {
            stopwatch.Stop();
            if (completed)
                LogAudit("request_completed", requestId, path, registration, startUtc, endUtc, responseStatus, rowCount, stopwatch.ElapsedMilliseconds, phase, null);
        }
    }

    private static object QueryHistory(ConnectorConfig config, string registration, DateTime startUtc, DateTime endUtc, out int rowCount)
    {
        const string sql = @"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT U_H.[Reg_No] AS [Registration], U_H.[TransDate] AS [DateTime],
       E_D.[EventDesc] AS [Event],
       CASE WHEN U_H.[IgnStatus] = 2 THEN 'ON' WHEN U_H.[IgnStatus] = 1 THEN 'OFF' ELSE 'N/A' END AS [Ignition],
       U_H.[Speed], U_H.[GeoLocation] AS [Location], U_H.[Inp5_Value] AS [VehicleVoltage],
       U_H.[Inp6_Value] AS [UnitVoltage], U_H.[Latitude], U_H.[Longitude], U_H.[Odometer]
FROM [dbo].[UnitHistory] AS U_H WITH (NOLOCK)
INNER JOIN [dbo].[EventDef] AS E_D WITH (NOLOCK) ON E_D.[EVENT_ID] = U_H.[event_id]
WHERE U_H.[Reg_No] = @registration AND U_H.[TransDate] >= @startUtc AND U_H.[TransDate] <= @endUtc
ORDER BY U_H.[TransDate];";
        var rows = new List<Dictionary<string, object>>();
        using (var connection = new SqlConnection(ConnectionString(config)))
        using (var command = new SqlCommand(sql, connection))
        {
            command.CommandTimeout = 30;
            command.Parameters.Add("@registration", SqlDbType.NVarChar, 100).Value = registration;
            command.Parameters.Add("@startUtc", SqlDbType.DateTime2).Value = startUtc;
            command.Parameters.Add("@endUtc", SqlDbType.DateTime2).Value = endUtc;
            connection.Open();
            using (var reader = command.ExecuteReader(CommandBehavior.SequentialAccess))
            {
                while (reader.Read())
                {
                    var row = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
                    for (int index = 0; index < reader.FieldCount; index++)
                    {
                        object value = reader.GetValue(index);
                        if (value != DBNull.Value && value is DateTime && reader.GetName(index).Equals("DateTime", StringComparison.OrdinalIgnoreCase))
                            value = DateTime.SpecifyKind((DateTime)value, DateTimeKind.Utc);
                        row[reader.GetName(index)] = value == DBNull.Value ? null : value;
                    }
                    rows.Add(row);
                }
            }
        }
        rowCount = rows.Count;
        return new { registration = registration, start = new DateTimeOffset(startUtc, TimeSpan.Zero).ToString("o"), end = new DateTimeOffset(endUtc, TimeSpan.Zero).ToString("o"), count = rowCount, rows = rows };
    }

    private static void WriteJson(HttpListenerContext context, int status, object value)
    {
        byte[] payload = Encoding.UTF8.GetBytes(Serialize(value));
        try
        {
            context.Response.StatusCode = status;
            context.Response.ContentType = "application/json; charset=utf-8";
            context.Response.ContentLength64 = payload.Length;
            context.Response.OutputStream.Write(payload, 0, payload.Length);
        }
        finally { context.Response.OutputStream.Close(); }
    }

    private static bool ConstantTimeEquals(string left, string right)
    {
        if (left == null || right == null) return false;
        byte[] a = Encoding.UTF8.GetBytes(left), b = Encoding.UTF8.GetBytes(right);
        int difference = a.Length ^ b.Length;
        for (int i = 0; i < Math.Max(a.Length, b.Length); i++) difference |= (i < a.Length ? a[i] : 0) ^ (i < b.Length ? b[i] : 0);
        return difference == 0;
    }

    private static string SafeMessage(Exception ex)
    {
        return ex is SqlException ? "SQL Server connection or query failed (error " + ((SqlException)ex).Number + ")." : ex.GetType().Name + ".";
    }

    private static bool IsClientDisconnect(Exception ex, string phase)
    {
        if (ex is HttpListenerException || ex is ObjectDisposedException) return true;
        return ex is IOException && phase != null && phase.IndexOf("response", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    private static void Log(string message)
    {
        AppendLog(LogPath, DateTimeOffset.Now.ToString("o") + " " + message);
    }

    private static string Serialize(object value)
    {
        lock (JsonSync) { return Json.Serialize(value); }
    }

    private static void LogAudit(string eventName, string requestId, string path, string registration,
        DateTime? startUtc, DateTime? endUtc, int? responseStatus, int? rowCount, long elapsedMs,
        string phase, Exception error)
    {
        try
        {
            var entry = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase) {
                { "timestamp", DateTimeOffset.Now.ToString("o") },
                { "event", eventName },
                { "request_id", requestId },
                { "path", path },
                { "query_name", string.Equals(path, "/history", StringComparison.OrdinalIgnoreCase) ? "UnitHistoryByRegistration" : null },
                { "registration", registration },
                { "start_utc", startUtc.HasValue ? startUtc.Value.ToString("o") : null },
                { "end_utc", endUtc.HasValue ? endUtc.Value.ToString("o") : null },
                { "response_status", responseStatus },
                { "row_count", rowCount },
                { "elapsed_ms", elapsedMs },
                { "phase", phase },
                { "error_type", error == null ? null : error.GetType().Name },
                { "error_code", error is SqlException ? (object)((SqlException)error).Number : error is HttpListenerException ? (object)((HttpListenerException)error).ErrorCode : null },
                { "error_message", error == null ? null : SafeMessage(error) }
            };
            AppendLog(AuditLogPath, Serialize(entry));
        }
        catch { }
    }

    private static void AppendLog(string path, string line)
    {
        try
        {
            lock (LogSync)
            {
                if (File.Exists(path) && new FileInfo(path).Length >= MaximumLogBytes)
                {
                    string rotatedPath = path + ".1";
                    if (File.Exists(rotatedPath)) File.Delete(rotatedPath);
                    File.Move(path, rotatedPath);
                }
                File.AppendAllText(path, line + Environment.NewLine, Encoding.UTF8);
            }
        }
        catch { }
    }
}
