// Uninstall.exe — removes MICO360 Tasks Server. Data (database, uploads, backups, settings) is
// kept unless the user ticks "Also delete all data" (silent: /DELETEDATA).
//
//   Uninstall.exe            ask, then remove
//   Uninstall.exe /S         remove silently, keep data
//   Uninstall.exe /S /DELETEDATA
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows.Forms;

namespace Mico360.Server
{
    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            var upper = args.Select(a => a.ToUpperInvariant()).ToArray();
            // Second stage: a copy in %TEMP% deletes the program folder once the original has exited.
            var cleanup = args.FirstOrDefault(a => a.StartsWith("/CLEANUP=", StringComparison.OrdinalIgnoreCase));
            if (cleanup != null) return Cleanup(cleanup.Substring(9).Trim('"'), args);

            Installation.RemoveStaleUninstallCopies();
            var installDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            var paths = ServerPaths.ForInstall(installDir);
            bool silent = upper.Contains("/S");
            bool deleteData = upper.Contains("/DELETEDATA");

            if (!silent)
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                using (var confirm = new ConfirmForm(paths))
                {
                    if (confirm.ShowDialog() != DialogResult.OK) return 1;
                    deleteData = confirm.DeleteData;
                }
            }

            try
            {
                StopServer(paths);
                Installation.RemoveShortcuts();
                Installation.Unregister();
                if (deleteData && Directory.Exists(paths.DataDir)) Directory.Delete(paths.DataDir, true);
            }
            catch (Exception e)
            {
                if (!silent) Dialogs.Error(null, "Uninstall could not finish: " + e.Message);
                else ConsoleOut.Line("Error: " + e.Message);
                return 1;
            }

            // This exe lives in the folder being removed: finish from a temporary copy.
            var temp = Path.Combine(Path.GetTempPath(), Installation.UninstallCopyPrefix + Guid.NewGuid().ToString("N") + ".exe");
            File.Copy(Process.GetCurrentProcess().MainModule.FileName, temp);
            Process.Start(new ProcessStartInfo(temp, "/CLEANUP=\"" + installDir + "\" " + Process.GetCurrentProcess().Id) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Path.GetTempPath() });
            if (!silent)
                MessageBox.Show(Product.Name + " was removed." + (deleteData ? "" : "\n\nYour data was kept in:\n" + paths.DataDir + "\nInstall again to use it, or delete that folder."),
                    Product.Name, MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }

        /// <summary>Stop the launcher (or a database left running without it).</summary>
        static void StopServer(ServerPaths paths)
        {
            if (Mutex.TryOpenExisting(Product.MutexName, out var running))
            {
                using (running)
                {
                    try { using (var stop = EventWaitHandle.OpenExisting(Product.StopEventName)) stop.Set(); } catch { }
                    try { if (running.WaitOne(TimeSpan.FromSeconds(120))) running.ReleaseMutex(); }
                    catch (AbandonedMutexException) { }
                }
            }
            new ServerManager(paths).StopMysql();
        }

        static int Cleanup(string installDir, string[] args)
        {
            // Wait for the original Uninstall.exe to exit so its file can be deleted.
            var pidArg = args.LastOrDefault();
            if (int.TryParse(pidArg, out var pid))
            {
                try { Process.GetProcessById(pid).WaitForExit(30000); } catch { }
            }
            for (int attempt = 0; attempt < 20 && Directory.Exists(installDir); attempt++)
            {
                try { Directory.Delete(installDir, true); }
                catch { Thread.Sleep(500); }
            }
            // This small temporary copy stays in %TEMP% until the next Setup/Uninstall run removes it
            // (Installation.RemoveStaleUninstallCopies). A "wait, then delete myself" command is how
            // malware cleans up, and antivirus software freezes programs that try it.
            return Directory.Exists(installDir) ? 1 : 0;
        }
    }

    sealed class ConfirmForm : Form
    {
        readonly CheckBox deleteData = new CheckBox { AutoSize = true, Font = Brand.Body };
        public bool DeleteData => deleteData.Checked;

        public ConfirmForm(ServerPaths paths)
        {
            Brand.ScaleForDpi(this);
            Text = "Uninstall " + Product.Name;
            Icon = Brand.AppIcon();
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(500, 230);
            BackColor = Color.White;
            Font = Brand.Body;
            var title = Brand.Text("Remove " + Product.Name + "?", Brand.Heading);
            title.Location = new Point(24, 20);
            var body = Brand.Text("The server is stopped and the program is removed from this computer. People can no longer open MICO360 Tasks from it.", Brand.Body, Brand.Muted);
            body.Location = new Point(24, 52);
            deleteData.Text = "Also delete all data — projects, tasks, uploaded files and backups in:\n" + paths.DataDir;
            deleteData.Location = new Point(24, 110);
            deleteData.ForeColor = Color.FromArgb(0xB4, 0x23, 0x18);
            var ok = new Button { Text = "Uninstall", Size = new Size(110, 32), Location = new Point(250, 180), BackColor = Brand.Red, ForeColor = Color.White, FlatStyle = FlatStyle.Flat, DialogResult = DialogResult.OK };
            var cancel = new Button { Text = "Cancel", Size = new Size(110, 32), Location = new Point(370, 180), DialogResult = DialogResult.Cancel };
            AcceptButton = cancel;
            CancelButton = cancel;
            deleteData.CheckedChanged += (s, e) =>
            {
                if (deleteData.Checked && MessageBox.Show(this, "This permanently deletes every project, task and file on this server. Continue?", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes)
                    deleteData.Checked = false;
            };
            Controls.AddRange(new Control[] { title, body, deleteData, ok, cancel });
        }
    }
}
