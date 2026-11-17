using System;
using System.IO;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Threading;

// Compile separately and run beside a copy of BISHistoryConnector.Live.exe in
// an empty directory, with standard input redirected. No database is accessed.
internal static class ConnectorStartupTests
{
    private static readonly Assembly Connector = Assembly.LoadFrom(
        Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "BISHistoryConnector.Live.exe"));
    private static readonly Type ProgramType = Connector.GetType("Program", true);
    private static readonly MethodInfo CreateMutex = ProgramType.GetMethod("CreateInstanceMutex", BindingFlags.Static | BindingFlags.NonPublic);
    private static readonly MethodInfo ConnectorMain = ProgramType.GetMethod("Main", BindingFlags.Static | BindingFlags.NonPublic);
    private static readonly string ProductionMutexName = (string)ProgramType.GetField("InstanceMutexName", BindingFlags.Static | BindingFlags.NonPublic).GetRawConstantValue();
    private static int passed;

    private static int Main()
    {
        try
        {
            Assert(Console.IsInputRedirected, "Run tests with standard input redirected to avoid interactive prompts.");
            Assert(!File.Exists(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "connection.dat")), "Tests require an empty directory without database configuration.");
            AssertMutexMissing(ProductionMutexName);
            TestFreshAndDuplicate();
            TestConcurrentLaunches();
            TestStartupWithExistingMutex(MutexRights.Modify, false);
            TestStartupWithExistingMutex(MutexRights.Modify | MutexRights.Synchronize, true);
            TestMissingConfiguration();
            Console.WriteLine("PASS: " + passed + " connector startup regression scenarios; no database configuration or queries used.");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("FAIL: " + error);
            return 1;
        }
    }

    private static void TestFreshAndDuplicate()
    {
        string name = @"Global\BISConnectorTest-" + Guid.NewGuid().ToString("N");
        bool owns;
        using (var first = OpenOrCreate(name, out owns))
        {
            Assert(owns && first != null, "First launch must own the mutex.");
            try
            {
                bool duplicateOwns;
                using (var duplicate = OpenOrCreate(name, out duplicateOwns))
                    Assert(!duplicateOwns && duplicate == null, "Second launch must not own or retain the mutex.");
            }
            finally { first.ReleaseMutex(); }
        }
        using (var restarted = OpenOrCreate(name, out owns))
        {
            Assert(owns && restarted != null, "A later launch must start after the first mutex is closed.");
            restarted.ReleaseMutex();
        }
        passed++;
    }

    private static void TestConcurrentLaunches()
    {
        string name = @"Global\BISConnectorTest-" + Guid.NewGuid().ToString("N");
        const int count = 8;
        int owners = 0;
        Exception failure = null;
        using (var start = new ManualResetEvent(false))
        using (var attempts = new CountdownEvent(count))
        {
            var threads = new Thread[count];
            for (int i = 0; i < count; i++)
            {
                threads[i] = new Thread(delegate()
                {
                    bool owns = false;
                    Mutex mutex = null;
                    start.WaitOne();
                    try
                    {
                        mutex = OpenOrCreate(name, out owns);
                        if (owns) Interlocked.Increment(ref owners);
                    }
                    catch (Exception error) { Interlocked.CompareExchange(ref failure, error, null); }
                    finally { attempts.Signal(); }
                    if (owns)
                    {
                        attempts.Wait();
                        mutex.ReleaseMutex();
                    }
                    if (mutex != null) mutex.Dispose();
                });
                threads[i].Start();
            }
            start.Set();
            foreach (var thread in threads) Assert(thread.Join(10000), "Concurrent launch timed out.");
            Assert(failure == null, "Concurrent startup failed: " + failure);
            Assert(owners == 1, "Exactly one simultaneous launch must own the mutex.");
        }
        passed++;
    }

    private static void TestStartupWithExistingMutex(MutexRights deniedRights, bool expectFailure)
    {
        var security = new MutexSecurity();
        var user = WindowsIdentity.GetCurrent().User;
        security.AddAccessRule(new MutexAccessRule(user, MutexRights.FullControl, AccessControlType.Allow));
        security.AddAccessRule(new MutexAccessRule(user, deniedRights, AccessControlType.Deny));
        bool created;
        using (var existing = new Mutex(false, ProductionMutexName, out created, security))
        {
            Assert(created, "Tests must never alter or use an existing connector mutex.");
            bool originalFailed = false;
            try { bool ignored; using (new Mutex(true, ProductionMutexName, out ignored)) { } }
            catch (UnauthorizedAccessException) { originalFailed = true; }
            Assert(originalFailed, "The original constructor must reproduce the screenshot's access-denied failure.");

            string output;
            int result = RunConnectorMain(out output);
            Assert(result == (expectFailure ? 2 : 0), "Incorrect startup exit code.");
            Assert(output.Contains(expectFailure ? "Windows denied access" : "No additional instance was started"), "Startup must explain the instance conflict.");
            string log = File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "connector.log"));
            string audit = File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "connector-audit.jsonl"));
            Assert(log.Contains(expectFailure ? "Startup blocked" : "Another BIS History Connector instance"), "Startup outcome must be logged.");
            Assert(audit.Contains(expectFailure ? "startup_failed" : "startup_already_running"), "Startup outcome must be audited.");
            Assert(audit.Contains("instance_check"), "Audit must identify the startup phase.");
        }
        AssertMutexMissing(ProductionMutexName);
        passed++;
    }

    private static void TestMissingConfiguration()
    {
        string output;
        Assert(RunConnectorMain(out output) == 2, "Missing configuration must exit before database access.");
        Assert(output.Contains("connection.dat") && output.Contains("configuration"), "Missing configuration must produce a useful message.");
        AssertMutexMissing(ProductionMutexName);
        passed++;
    }

    private static int RunConnectorMain(out string output)
    {
        var originalError = Console.Error;
        using (var capture = new StringWriter())
        {
            Console.SetError(capture);
            try
            {
                int result = (int)ConnectorMain.Invoke(null, null);
                output = capture.ToString();
                return result;
            }
            finally { Console.SetError(originalError); }
        }
    }

    private static Mutex OpenOrCreate(string name, out bool owns)
    {
        object[] arguments = { name, false };
        var mutex = (Mutex)CreateMutex.Invoke(null, arguments);
        owns = (bool)arguments[1];
        return mutex;
    }

    private static void AssertMutexMissing(string name)
    {
        try { using (Mutex.OpenExisting(name, MutexRights.Synchronize)) { } }
        catch (WaitHandleCannotBeOpenedException) { return; }
        throw new InvalidOperationException("A connector mutex already exists on this computer; do not run these tests alongside a connector.");
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
