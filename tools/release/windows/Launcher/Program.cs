// "MICO360 Tasks Server.exe" — starts the bundled database + server, lives in the notification
// area, and opens the web app. Run it again to open the app; "--stop" stops a running server.
//
//   MICO360 Tasks Server.exe                 start (first run: asks for the administrator) and open the browser
//   MICO360 Tasks Server.exe --no-browser    start without opening the browser (sign-in start)
//   MICO360 Tasks Server.exe --stop          stop the running server and exit
using System;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Mico360.Server
{
    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            bool stop = args.Contains("--stop"), noBrowser = args.Contains("--no-browser");
            var installDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            var paths = ServerPaths.ForInstall(installDir);

            using (var mutex = new Mutex(true, Product.MutexName, out bool first))
            {
                if (!first)
                {
                    // Already running: hand the request to that instance.
                    SignalEvent(stop ? Product.StopEventName : Product.OpenEventName);
                    if (!stop) return 0;
                    try { if (mutex.WaitOne(TimeSpan.FromSeconds(120))) mutex.ReleaseMutex(); }
                    catch (AbandonedMutexException) { }
                    return 0;
                }
                if (stop) return 0; // nothing to stop

                var app = new TrayApp(paths, !noBrowser);
                Application.Run(app);
                return app.ExitCode;
            }
        }

        static void SignalEvent(string name)
        {
            try { using (var e = EventWaitHandle.OpenExisting(name)) e.Set(); } catch { }
        }
    }

    sealed class TrayApp : ApplicationContext
    {
        readonly ServerPaths paths;
        readonly ServerManager server;
        readonly NotifyIcon tray;
        readonly EventWaitHandle stopEvent, openEvent;
        readonly SynchronizationContext ui;
        readonly System.Windows.Forms.Timer watchdog;
        readonly ToolStripMenuItem networkItem;
        int restartsInWindow;
        DateTime windowStart = DateTime.UtcNow;
        bool running, busy, exiting;
        public int ExitCode { get; private set; }

        public TrayApp(ServerPaths paths, bool openBrowser)
        {
            this.paths = paths;
            server = new ServerManager(paths);
            ui = new WindowsFormsSynchronizationContext();
            SynchronizationContext.SetSynchronizationContext(ui);

            stopEvent = new EventWaitHandle(false, EventResetMode.AutoReset, Product.StopEventName);
            openEvent = new EventWaitHandle(false, EventResetMode.AutoReset, Product.OpenEventName);
            ThreadPool.RegisterWaitForSingleObject(stopEvent, (s, t) => ui.Post(_ => Exit(), null), null, Timeout.Infinite, false);
            ThreadPool.RegisterWaitForSingleObject(openEvent, (s, t) => ui.Post(_ => OpenApp(), null), null, Timeout.Infinite, false);

            var menu = new ContextMenuStrip();
            var open = new ToolStripMenuItem("Open MICO360 Tasks", null, (s, e) => OpenApp()) { Font = new Font(SystemFonts.MenuFont, FontStyle.Bold) };
            networkItem = new ToolStripMenuItem("Office network address…", null, (s, e) => ShowNetworkAddress());
            menu.Items.Add(open);
            menu.Items.Add(networkItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(new ToolStripMenuItem("Back up the database now", null, (s, e) => Backup()));
            menu.Items.Add(new ToolStripMenuItem("Open data folder", null, (s, e) => Shell.Open(paths.DataDir)));
            menu.Items.Add(new ToolStripMenuItem("Open logs folder", null, (s, e) => Shell.Open(paths.LogsDir)));
            menu.Items.Add(new ToolStripMenuItem("Edit server settings", null, (s, e) => EditSettings()));
            menu.Items.Add(new ToolStripMenuItem("Restart the server", null, (s, e) => Restart()));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(new ToolStripMenuItem("Stop the server and exit", null, (s, e) => Exit()));
            menu.Opening += (s, e) => networkItem.Visible = running && SafeNetworkUrl() != null;

            tray = new NotifyIcon { Icon = Brand.AppIcon(), Text = Product.Name + " — starting…", ContextMenuStrip = menu, Visible = true };
            tray.DoubleClick += (s, e) => OpenApp();
            tray.BalloonTipClicked += (s, e) => OpenApp();

            watchdog = new System.Windows.Forms.Timer { Interval = 5000 };
            watchdog.Tick += (s, e) => CheckServer();

            SystemEvents.SessionEnding += (s, e) => { if (!exiting) { exiting = true; try { server.Stop(); } catch { } } };

            ui.Post(_ => Begin(openBrowser), null);
        }

        void Begin(bool openBrowser)
        {
            if (!server.IsInitialized)
            {
                using (var setup = new FirstRunForm(server))
                {
                    if (setup.ShowDialog() != DialogResult.OK) { ExitCode = 1; Quit(); return; }
                }
            }
            RunInBackground("Starting " + Product.Name, () => server.Start(), ok =>
            {
                if (!ok) { ExitCode = 1; Quit(); return; }
                running = true;
                tray.Text = Truncate(Product.Name + " — running at " + server.LocalUrl);
                watchdog.Start();
                var lan = SafeNetworkUrl();
                tray.ShowBalloonTip(6000, "MICO360 Tasks is running", "Open " + server.LocalUrl + (lan != null ? "\nOffice network: " + lan : ""), ToolTipIcon.Info);
                if (openBrowser) OpenApp();
            });
        }

        /// <summary>Run work off the UI thread behind a progress window; errors are shown to the user.</summary>
        void RunInBackground(string title, Action work, Action<bool> done)
        {
            busy = true;
            var progress = new ProgressForm(title);
            Action<string> onProgress = progress.Step;
            server.Progress += onProgress;
            progress.Show();
            var t = new Thread(() =>
            {
                Exception error = null;
                try { work(); } catch (Exception e) { error = e; }
                ui.Post(_ =>
                {
                    server.Progress -= onProgress;
                    progress.Close();
                    busy = false;
                    if (error != null)
                    {
                        server.Log("launcher", "Error: " + error);
                        Dialogs.Error(null, error is ServerException ? error.Message : "Something went wrong: " + error.Message, paths.LogsDir);
                    }
                    done(error == null);
                }, null);
            }) { IsBackground = true };
            t.Start();
        }

        void OpenApp()
        {
            if (!running) { if (!busy) tray.ShowBalloonTip(3000, Product.Name, "The server is not running.", ToolTipIcon.Warning); return; }
            Shell.Open(server.LocalUrl);
        }

        string SafeNetworkUrl()
        {
            try { return server.NetworkUrl; } catch { return null; }
        }

        void ShowNetworkAddress()
        {
            var url = SafeNetworkUrl();
            if (url == null) return;
            try { Clipboard.SetText(url); } catch { }
            MessageBox.Show(
                "Other computers and phones on your office network can open MICO360 Tasks at:\n\n" + url +
                "\n\n(Copied to the clipboard.) In the phone app, enter this address under \"Server: … · Change\" on the sign-in screen." +
                "\n\nIf Windows asked whether to allow Node.js through the firewall, allow it on private networks.",
                Product.Name, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        void EditSettings()
        {
            try { System.Diagnostics.Process.Start("notepad.exe", ServerManager.Q(paths.ServerEnv)); } catch { }
            tray.ShowBalloonTip(5000, Product.Name, "After saving your changes, choose \"Restart the server\" from this icon.", ToolTipIcon.Info);
        }

        void Backup()
        {
            if (busy || !running) return;
            string file = null;
            RunInBackground("Backing up the database", () => file = server.BackupDatabase(), ok =>
            {
                if (ok && MessageBox.Show("Backup saved:\n" + file + "\n\nAlso copy the uploads folder to keep attachments:\n" + paths.UploadsDir + "\n\nOpen the backups folder?",
                        Product.Name, MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                    Shell.Open(paths.BackupsDir);
            });
        }

        void Restart()
        {
            if (busy) return;
            running = false;
            watchdog.Stop();
            RunInBackground("Restarting " + Product.Name, () => server.RestartNode(), ok =>
            {
                running = ok;
                if (ok) { watchdog.Start(); tray.ShowBalloonTip(3000, Product.Name, "Restarted.", ToolTipIcon.Info); }
            });
        }

        /// <summary>Restart the web server if it stopped by itself (at most 3 times in 10 minutes).</summary>
        void CheckServer()
        {
            if (!running || busy || server.NodeRunning) return;
            if (DateTime.UtcNow - windowStart > TimeSpan.FromMinutes(10)) { windowStart = DateTime.UtcNow; restartsInWindow = 0; }
            server.Log("launcher", "The server stopped unexpectedly (exit code " + server.NodeExitCode + ").");
            if (++restartsInWindow > 3)
            {
                running = false;
                watchdog.Stop();
                tray.Text = Truncate(Product.Name + " — stopped");
                Dialogs.Error(null, "MICO360 Tasks keeps stopping. Check the server log, then choose \"Restart the server\" from the tray icon.", paths.LogsDir);
                return;
            }
            Restart();
        }

        void Exit()
        {
            if (exiting) return;
            exiting = true;
            watchdog.Stop();
            tray.Text = Truncate(Product.Name + " — stopping…");
            var progress = new ProgressForm("Stopping " + Product.Name);
            progress.Step("Stopping the server and the database…");
            progress.Show();
            var t = new Thread(() =>
            {
                try { server.Stop(); } catch (Exception e) { server.Log("launcher", "Stop: " + e.Message); }
                ui.Post(_ => { progress.Close(); Quit(); }, null);
            }) { IsBackground = true };
            t.Start();
        }

        void Quit()
        {
            exiting = true;
            tray.Visible = false;
            tray.Dispose();
            server.Dispose();
            ExitThread();
        }

        static string Truncate(string s) => s.Length > 63 ? s.Substring(0, 63) : s;
    }

    /// <summary>Shown when the data folder has no database yet (e.g. after it was deleted).</summary>
    sealed class FirstRunForm : Form
    {
        readonly ServerManager server;
        readonly AdminFields admin = new AdminFields();
        readonly CheckBox network = new CheckBox { Text = "Allow other computers and phones on the office network to connect", Checked = true, AutoSize = true, Font = Brand.Body };
        readonly NumericUpDown port = new NumericUpDown { Minimum = 1024, Maximum = 65535, Value = Product.DefaultHttpPort, Width = 90, Font = Brand.Body };

        public FirstRunForm(ServerManager server)
        {
            this.server = server;
            Brand.ScaleForDpi(this);
            Text = Product.Name + " — first-time setup";
            Icon = Brand.AppIcon();
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(520, 470);
            BackColor = Color.White;
            Font = Brand.Body;

            var intro = Brand.Text("Create the administrator account for this server. The database is stored in:\n" + server.Paths.DataDir, Brand.Body, Brand.Muted);
            intro.Location = new Point(28, 20);
            admin.Location = new Point(28, 76);
            var portLabel = Brand.Text("Web address port:");
            portLabel.Location = new Point(28, 344);
            port.Location = new Point(160, 340);
            network.Location = new Point(28, 376);
            var ok = new Button { Text = "Create and start", Size = new Size(140, 32), Location = new Point(236, 420), BackColor = Brand.Red, ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
            var cancel = new Button { Text = "Cancel", Size = new Size(100, 32), Location = new Point(388, 420), DialogResult = DialogResult.Cancel };
            ok.Click += (s, e) => Create();
            AcceptButton = ok;
            CancelButton = cancel;
            Controls.AddRange(new Control[] { intro, admin, portLabel, port, network, ok, cancel });
            Shown += (s, e) => admin.FocusFirstEmpty();
        }

        void Create()
        {
            var account = admin.Read(out var error);
            if (account == null) { MessageBox.Show(this, error, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
            var options = new InitOptions { Admin = account, HttpPort = (int)port.Value, AllowNetwork = network.Checked };
            Enabled = false;
            var progress = new ProgressForm("Setting up " + Product.Name);
            Action<string> onProgress = progress.Step;
            server.Progress += onProgress;
            progress.Show(this);
            var ui = SynchronizationContext.Current;
            new Thread(() =>
            {
                Exception failure = null;
                try { server.Initialize(options); } catch (Exception e) { failure = e; }
                ui.Post(_ =>
                {
                    server.Progress -= onProgress;
                    progress.Close();
                    Enabled = true;
                    if (failure != null)
                    {
                        server.Log("launcher", "Setup failed: " + failure);
                        Dialogs.Error(this, failure is ServerException ? failure.Message : "Setup failed: " + failure.Message, server.Paths.LogsDir);
                        return;
                    }
                    DialogResult = DialogResult.OK;
                    Close();
                }, null);
            }) { IsBackground = true }.Start();
        }
    }
}
