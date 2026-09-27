// Per-user installation records: Apps & features entry, shortcuts and the optional sign-in start.
using System;
using System.IO;
using System.Reflection;
using Microsoft.Win32;

namespace Mico360.Server
{
    public static class Installation
    {
        const string UninstallRoot = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\";
        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

        public static string StartMenuFolder => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Product.Name);
        public static string DesktopShortcut => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Product.Name + ".lnk");

        /// <summary>The folder of an existing installation, from its Apps & features entry.</summary>
        public static string ExistingInstallDir()
        {
            using (var k = Registry.CurrentUser.OpenSubKey(UninstallRoot + Product.RegistryKey))
            {
                var dir = k?.GetValue("InstallLocation") as string;
                return !string.IsNullOrEmpty(dir) && File.Exists(Path.Combine(dir, Product.LauncherExe)) ? dir : null;
            }
        }

        public static void Register(ServerPaths paths, long sizeKb)
        {
            using (var k = Registry.CurrentUser.CreateSubKey(UninstallRoot + Product.RegistryKey))
            {
                k.SetValue("DisplayName", Product.Name);
                k.SetValue("DisplayVersion", Product.Version);
                k.SetValue("Publisher", Product.Publisher);
                k.SetValue("DisplayIcon", paths.LauncherExe);
                k.SetValue("InstallLocation", paths.InstallDir);
                k.SetValue("UninstallString", "\"" + paths.UninstallExe + "\"");
                k.SetValue("QuietUninstallString", "\"" + paths.UninstallExe + "\" /S");
                k.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
                k.SetValue("EstimatedSize", (int)Math.Min(int.MaxValue, sizeKb), RegistryValueKind.DWord);
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("URLInfoAbout", "https://task.mico360.com");
            }
        }

        public static void Unregister()
        {
            Registry.CurrentUser.DeleteSubKeyTree(UninstallRoot + Product.RegistryKey, false);
            SetStartAtSignIn(null, false);
        }

        public static void CreateShortcuts(ServerPaths paths, bool desktop)
        {
            Directory.CreateDirectory(StartMenuFolder);
            CreateShortcut(Path.Combine(StartMenuFolder, Product.Name + ".lnk"), paths.LauncherExe, "", paths.InstallDir, "Start MICO360 Tasks and open it in your browser");
            CreateShortcut(Path.Combine(StartMenuFolder, "Uninstall " + Product.Name + ".lnk"), paths.UninstallExe, "", paths.InstallDir, "Remove MICO360 Tasks Server");
            if (desktop) CreateShortcut(DesktopShortcut, paths.LauncherExe, "", paths.InstallDir, "Start MICO360 Tasks and open it in your browser");
        }

        public static void RemoveShortcuts()
        {
            try { if (Directory.Exists(StartMenuFolder)) Directory.Delete(StartMenuFolder, true); } catch { }
            try { if (File.Exists(DesktopShortcut)) File.Delete(DesktopShortcut); } catch { }
        }

        /// <summary>Start the server (without opening a browser) when this user signs in to Windows.</summary>
        public static void SetStartAtSignIn(ServerPaths paths, bool enabled)
        {
            using (var k = Registry.CurrentUser.OpenSubKey(RunKey, true) ?? Registry.CurrentUser.CreateSubKey(RunKey))
            {
                if (enabled) k.SetValue(Product.RegistryKey, "\"" + paths.LauncherExe + "\" --no-browser");
                else if (k.GetValue(Product.RegistryKey) != null) k.DeleteValue(Product.RegistryKey, false);
            }
        }

        public static bool StartsAtSignIn()
        {
            using (var k = Registry.CurrentUser.OpenSubKey(RunKey)) return k?.GetValue(Product.RegistryKey) != null;
        }

        static void CreateShortcut(string lnk, string target, string args, string workDir, string description)
        {
            var type = Type.GetTypeFromProgID("WScript.Shell");
            var shell = Activator.CreateInstance(type);
            try
            {
                var sc = type.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnk });
                var st = sc.GetType();
                st.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { target });
                st.InvokeMember("Arguments", BindingFlags.SetProperty, null, sc, new object[] { args });
                st.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { workDir });
                st.InvokeMember("Description", BindingFlags.SetProperty, null, sc, new object[] { description });
                st.InvokeMember("IconLocation", BindingFlags.SetProperty, null, sc, new object[] { target + ",0" });
                st.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
            }
            finally { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell); }
        }

        public const string UninstallCopyPrefix = "MICO360TasksServer-uninstall-";

        /// <summary>Delete the temporary uninstaller copies earlier uninstalls left in %TEMP% (skips any still running).</summary>
        public static void RemoveStaleUninstallCopies()
        {
            try
            {
                foreach (var f in Directory.GetFiles(Path.GetTempPath(), UninstallCopyPrefix + "*.exe"))
                {
                    try { File.Delete(f); } catch { }
                }
            }
            catch { }
        }

        /// <summary>Total size of a folder in KB (for Apps & features).</summary>
        public static long FolderSizeKb(string dir)
        {
            long bytes = 0;
            foreach (var f in new DirectoryInfo(dir).EnumerateFiles("*", SearchOption.AllDirectories)) bytes += f.Length;
            return bytes / 1024;
        }
    }
}
