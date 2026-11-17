using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

internal static class Program
{
    private static int Main(string[] args)
    {
        if (args.Length != 2) return 2;
        string bootstrapPath = Path.GetFullPath(args[0]);
        string outputPath = Path.GetFullPath(args[1]);
        byte[] plain = null;
        try
        {
            plain = File.ReadAllBytes(bootstrapPath);
            if (plain.Length < 20 || plain.Length > 65536) return 3;
            byte[] encrypted = ProtectedData.Protect(plain, null, DataProtectionScope.LocalMachine);
            string temporaryPath = outputPath + ".tmp";
            File.WriteAllBytes(temporaryPath, encrypted);
            if (File.Exists(outputPath)) File.Replace(temporaryPath, outputPath, null);
            else File.Move(temporaryPath, outputPath);
            return 0;
        }
        finally
        {
            if (plain != null) Array.Clear(plain, 0, plain.Length);
            try { if (File.Exists(bootstrapPath)) File.Delete(bootstrapPath); } catch { }
        }
    }
}
