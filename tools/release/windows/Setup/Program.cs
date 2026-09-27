// MICO360 Tasks Server Setup — a per-user installer (no administrator rights needed) that carries
// the whole server (Node.js, MySQL, the API and the web app) as an embedded payload.
//
// Interactive: run the exe. Silent (IT / scripted installs):
//   Setup.exe /S [/D=<install folder>] [/DATA=<data folder>] [/PORT=4000] [/LOCALONLY]
//             [/NODESKTOP] [/NOSHORTCUTS] [/AUTOSTART] [/LAUNCH]
// A silent first install reads the administrator from MICO360_ADMIN_EMAIL, MICO360_ADMIN_USERNAME,
// MICO360_ADMIN_PASSWORD (and optional MICO360_ADMIN_FIRST_NAME / _LAST_NAME) — never from the
// command line, where other programs could read it. Exit code 0 = installed.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

namespace Mico360.Server
{
    sealed class SetupOptions
    {
        public string InstallDir = ServerPaths.DefaultInstallDir;
        public string DataDir = ServerPaths.DefaultDataDir;
        public int Port = Product.DefaultHttpPort;
        public bool AllowNetwork = true;
        public bool Shortcuts = true;
        public bool Desktop = true;
        public bool AutoStart;
        public bool Launch = true;
        public AdminAccount Admin;
        public bool Upgrade;

        public ServerPaths Paths => new ServerPaths(InstallDir, DataDir);
        public bool DataReady => new ServerManager(Paths).IsInitialized;
    }

    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            var o = new SetupOptions();
            var existing = Installation.ExistingInstallDir();
            if (existing != null)
            {
                o.Upgrade = true;
                o.InstallDir = existing;
                o.DataDir = ServerPaths.ForInstall(existing).DataDir;
            }
            bool silent = false;
            foreach (var a in args)
            {
                var up = a.ToUpperInvariant();
                if (up == "/S") silent = true;
                else if (up.StartsWith("/D=")) o.InstallDir = a.Substring(3).Trim('"');
                else if (up.StartsWith("/DATA=")) o.DataDir = a.Substring(6).Trim('"');
                else if (up.StartsWith("/PORT=") && int.TryParse(a.Substring(6), out var p)) o.Port = p;
                else if (up == "/LOCALONLY") o.AllowNetwork = false;
                else if (up == "/NODESKTOP") o.Desktop = false;
                else if (up == "/NOSHORTCUTS") { o.Shortcuts = false; o.Desktop = false; }
                else if (up == "/AUTOSTART") o.AutoStart = true;
                else if (up == "/LAUNCH") o.Launch = true;
                else if (up == "/?" || up == "/HELP")
                {
                    ConsoleOut.Line("Usage: Setup.exe [/S] [/D=<folder>] [/DATA=<folder>] [/PORT=4000] [/LOCALONLY] [/NODESKTOP] [/NOSHORTCUTS] [/AUTOSTART] [/LAUNCH]");
                    return 0;
                }
            }

            if (silent)
            {
                if (!args.Any(a => a.ToUpperInvariant() == "/LAUNCH")) o.Launch = false;
                return SilentInstall(o);
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupWizard(o));
            return 0;
        }

        static int SilentInstall(SetupOptions o)
        {
            var log = Path.Combine(Path.GetTempPath(), "MICO360TasksServer-setup.log");
            void Say(string m)
            {
                var line = DateTime.Now.ToString("HH:mm:ss") + " " + m;
                try { File.AppendAllText(log, line + Environment.NewLine); } catch { }
                ConsoleOut.Line(line);
            }
            try
            {
                Say("Installing " + Product.Name + " " + Product.Version + " to " + o.InstallDir + " (data: " + o.DataDir + ")");
                var problem = Installer.CheckOptions(o);
                if (problem != null) { Say("Error: " + problem); return 2; }
                if (!o.DataReady)
                {
                    o.Admin = new AdminAccount
                    {
                        Email = Environment.GetEnvironmentVariable("MICO360_ADMIN_EMAIL"),
                        Username = Environment.GetEnvironmentVariable("MICO360_ADMIN_USERNAME"),
                        Password = Environment.GetEnvironmentVariable("MICO360_ADMIN_PASSWORD"),
                        FirstName = Environment.GetEnvironmentVariable("MICO360_ADMIN_FIRST_NAME") ?? "Admin",
                        LastName = Environment.GetEnvironmentVariable("MICO360_ADMIN_LAST_NAME") ?? "User",
                    };
                    var bad = o.Admin.Validate();
                    if (bad != null) { Say("Error: administrator account — " + bad + " (set MICO360_ADMIN_EMAIL / _USERNAME / _PASSWORD)"); return 2; }
                }
                Installer.Run(o, Say, pct => { });
                Say("Done.");
                return 0;
            }
            catch (Exception e)
            {
                Say("Error: " + (e is ServerException ? e.Message : e.ToString()));
                return 1;
            }
        }
    }

    /// <summary>The installation steps, shared by the wizard and silent mode.</summary>
    static class Installer
    {
        static readonly string[] ProgramFolders = { "app", "node", "mysql", "licenses" };

        public static string CheckOptions(SetupOptions o)
        {
            if (!Environment.Is64BitOperatingSystem) return "MICO360 Tasks Server needs 64-bit Windows 10 or later.";
            if (!Path.IsPathRooted(o.InstallDir) || !Path.IsPathRooted(o.DataDir)) return "Choose full folder paths (for example C:\\MICO360 Tasks Server).";
            var inst = Path.GetFullPath(o.InstallDir).TrimEnd('\\') + "\\";
            var data = Path.GetFullPath(o.DataDir).TrimEnd('\\') + "\\";
            if (data.StartsWith(inst, StringComparison.OrdinalIgnoreCase) || inst.StartsWith(data, StringComparison.OrdinalIgnoreCase))
                return "Keep the data folder separate from the program folder (uninstalling removes the program folder).";
            if (o.Port < 1024 || o.Port > 65535) return "Choose a port between 1024 and 65535.";
            try
            {
                var drive = new DriveInfo(Path.GetPathRoot(inst));
                long need = PayloadSize() + 300L * 1024 * 1024;
                if (drive.AvailableFreeSpace < need) return "Not enough free space on " + drive.Name + " (about " + (need / (1024 * 1024)) + " MB needed).";
            }
            catch { }
            return null;
        }

        static Stream Payload() =>
            Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip") ?? throw new ServerException("This installer is damaged (no payload). Download it again.");

        public static long PayloadSize()
        {
            using (var zip = new ZipArchive(Payload(), ZipArchiveMode.Read)) return zip.Entries.Sum(e => e.Length);
        }

        public static void Run(SetupOptions o, Action<string> say, Action<int> percent)
        {
            var paths = o.Paths;

            Installation.RemoveStaleUninstallCopies();
            StopRunningServer(say);

            say("Copying program files…");
            Directory.CreateDirectory(paths.InstallDir);
            foreach (var f in ProgramFolders)
            {
                var dir = Path.Combine(paths.InstallDir, f);
                if (Directory.Exists(dir)) Directory.Delete(dir, true);
            }
            var root = Path.GetFullPath(paths.InstallDir).TrimEnd('\\') + "\\";
            using (var zip = new ZipArchive(Payload(), ZipArchiveMode.Read))
            {
                long total = Math.Max(1, zip.Entries.Sum(e => e.Length)), done = 0;
                int lastPct = -1;
                foreach (var entry in zip.Entries)
                {
                    var target = Path.GetFullPath(Path.Combine(root, entry.FullName));
                    if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new ServerException("The installer payload is invalid.");
                    if (entry.FullName.EndsWith("/")) { Directory.CreateDirectory(target); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    entry.ExtractToFile(target, true);
                    done += entry.Length;
                    int pct = (int)(done * 100 / total);
                    if (pct != lastPct) { percent(pct); lastPct = pct; }
                }
            }
            File.WriteAllText(paths.DataDirMarker, paths.DataDir);

            say("Registering the program…");
            Installation.Register(paths, Installation.FolderSizeKb(paths.InstallDir));
            if (o.Shortcuts) Installation.CreateShortcuts(paths, o.Desktop);
            Installation.SetStartAtSignIn(paths, o.AutoStart);

            var server = new ServerManager(paths);
            if (!server.IsInitialized)
            {
                percent(-1);
                server.Progress += say;
                server.Initialize(new InitOptions { Admin = o.Admin, HttpPort = o.Port, AllowNetwork = o.AllowNetwork });
                server.Progress -= say;
            }
            else say("Keeping the existing database in " + paths.DataDir + " (it is updated when the server starts).");

            if (o.Launch)
            {
                say("Starting " + Product.Name + "…");
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(paths.LauncherExe) { UseShellExecute = false, WorkingDirectory = paths.InstallDir });
            }
        }

        /// <summary>An upgrade must stop the running server first, or its files are locked.</summary>
        static void StopRunningServer(Action<string> say)
        {
            Mutex running;
            if (!Mutex.TryOpenExisting(Product.MutexName, out running)) return;
            say("Stopping the running server…");
            try
            {
                using (var stop = EventWaitHandle.OpenExisting(Product.StopEventName)) stop.Set();
                bool released;
                try { released = running.WaitOne(TimeSpan.FromSeconds(120)); }
                catch (AbandonedMutexException) { released = true; }
                if (released) running.ReleaseMutex();
                else throw new ServerException("The running server did not stop. Stop it from its tray icon (Stop the server and exit), then run Setup again.");
            }
            finally { running.Dispose(); }
        }
    }

    sealed class SetupWizard : Form
    {
        readonly SetupOptions o;
        readonly Panel content = new Panel { Bounds = new Rectangle(220, 0, 500, 440), BackColor = Color.White };
        readonly Button back = new Button { Text = "< Back", Size = new Size(90, 30) };
        readonly Button next = new Button { Text = "Next >", Size = new Size(110, 30) };
        readonly Button cancel = new Button { Text = "Cancel", Size = new Size(90, 30) };
        readonly List<Func<Panel>> pages = new List<Func<Panel>>();
        int page;
        bool installing, finished;

        // Options page
        readonly TextBox installBox = new TextBox(), dataBox = new TextBox();
        readonly NumericUpDown portBox = new NumericUpDown { Minimum = 1024, Maximum = 65535 };
        readonly CheckBox networkBox = new CheckBox { Text = "Allow other computers and phones on the office network to connect" };
        readonly CheckBox desktopBox = new CheckBox { Text = "Create a desktop shortcut" };
        readonly CheckBox autoStartBox = new CheckBox { Text = "Start the server automatically when I sign in to Windows" };
        readonly AdminFields admin = new AdminFields();
        // Progress / finish
        readonly Label stepLabel = Brand.Text("");
        readonly ProgressBar bar = new ProgressBar { Size = new Size(440, 18) };
        readonly TextBox log = new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Size = new Size(440, 230), Font = Brand.Small, BackColor = Color.FromArgb(0xF6, 0xF7, 0xF9), BorderStyle = BorderStyle.FixedSingle };
        readonly CheckBox launchBox = new CheckBox { Text = "Open MICO360 Tasks now", Checked = true };

        public SetupWizard(SetupOptions options)
        {
            o = options;
            Brand.ScaleForDpi(this);
            Text = Product.Name + " " + Product.Version + " Setup";
            Icon = Brand.AppIcon();
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(720, 500);
            BackColor = Color.White;
            Font = Brand.Body;

            var banner = new Panel { Bounds = new Rectangle(0, 0, 220, 440), BackColor = Brand.Red };
            var logo = Brand.EmbeddedImage("logo-w.png");
            if (logo != null) banner.Controls.Add(new PictureBox { Image = logo, SizeMode = PictureBoxSizeMode.Zoom, Bounds = new Rectangle(40, 40, 140, 140), BackColor = Color.Transparent });
            banner.Controls.Add(new Label { Text = "MICO360 Tasks\nServer", Font = new Font("Segoe UI Semibold", 16f), ForeColor = Color.White, BackColor = Color.Transparent, Bounds = new Rectangle(20, 200, 190, 70), TextAlign = ContentAlignment.MiddleCenter });
            banner.Controls.Add(new Label { Text = "Version " + Product.Version, Font = Brand.Small, ForeColor = Color.FromArgb(0xF3, 0xD6, 0xD6), BackColor = Color.Transparent, Bounds = new Rectangle(20, 272, 190, 20), TextAlign = ContentAlignment.MiddleCenter });
            var bottom = new Panel { Bounds = new Rectangle(0, 440, 720, 60), BackColor = Color.FromArgb(0xF6, 0xF7, 0xF9) };
            bottom.Paint += (s, e) => e.Graphics.DrawLine(new Pen(Brand.Line), 0, 0, 720, 0);
            back.Location = new Point(400, 15);
            next.Location = new Point(496, 15);
            cancel.Location = new Point(616, 15);
            next.BackColor = Brand.Red;
            next.ForeColor = Color.White;
            next.FlatStyle = FlatStyle.Flat;
            next.FlatAppearance.BorderColor = Brand.RedDark;
            bottom.Controls.AddRange(new Control[] { back, next, cancel });
            Controls.AddRange(new Control[] { banner, content, bottom });

            back.Click += (s, e) => Show(page - 1);
            next.Click += (s, e) => Next();
            cancel.Click += (s, e) => Close();
            FormClosing += (s, e) =>
            {
                if (installing) { e.Cancel = true; return; }
                if (!finished && MessageBox.Show(this, "Cancel the installation?", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) e.Cancel = true;
            };

            installBox.Text = o.InstallDir;
            dataBox.Text = o.DataDir;
            portBox.Value = o.Port;
            networkBox.Checked = o.AllowNetwork;
            desktopBox.Checked = o.Desktop;
            autoStartBox.Checked = Installation.StartsAtSignIn();

            pages.Add(WelcomePage);
            pages.Add(OptionsPage);
            pages.Add(AdminPage);
            pages.Add(InstallPage);
            pages.Add(FinishPage);
            Show(0);
        }

        static Panel NewPage(string title, string subtitle)
        {
            var p = new Panel { Dock = DockStyle.Fill, BackColor = Color.White, Padding = new Padding(28, 24, 28, 0) };
            var t = Brand.Text(title, Brand.Title);
            t.Location = new Point(28, 24);
            p.Controls.Add(t);
            if (subtitle != null)
            {
                var s = Brand.Text(subtitle, Brand.Body, Brand.Muted);
                s.Location = new Point(28, 64);
                p.Controls.Add(s);
            }
            return p;
        }

        Panel WelcomePage()
        {
            var p = NewPage(o.Upgrade ? "Update MICO360 Tasks Server" : "Install MICO360 Tasks Server",
                "Runs MICO360 Tasks on this computer: the web app, the server the phone app and Chrome extension connect to, and its own database.");
            var body = Brand.Text(
                "Everything it needs is included — Node.js, MySQL and the app — so there is nothing else to install, and no administrator rights are needed.\n\n" +
                "After setup, MICO360 Tasks opens in your browser and a tray icon lets you open it, back up the database, or stop the server.\n\n" +
                (o.Upgrade ? "An existing installation was found in:\n" + o.InstallDir + "\nIt will be updated to version " + Product.Version + ". Your projects, tasks and files are kept.\n\n" : "") +
                "Click Next to continue.");
            body.Location = new Point(28, 118);
            p.Controls.Add(body);
            return p;
        }

        Panel OptionsPage()
        {
            var p = NewPage("Options", null);
            int y = 70;
            void Row(string label, TextBox box, bool folder, bool enabled)
            {
                var l = Brand.Text(label, Brand.Small, Brand.Muted);
                l.Location = new Point(28, y);
                box.Bounds = new Rectangle(28, y + 20, 340, 26);
                box.Enabled = enabled;
                var browse = new Button { Text = "Browse…", Bounds = new Rectangle(376, y + 19, 90, 28), Enabled = enabled };
                browse.Click += (s, e) =>
                {
                    using (var d = new FolderBrowserDialog { SelectedPath = box.Text, ShowNewFolderButton = true })
                        if (d.ShowDialog(this) == DialogResult.OK) box.Text = d.SelectedPath.EndsWith("MICO360 Tasks Server") ? d.SelectedPath : Path.Combine(d.SelectedPath, "MICO360 Tasks Server");
                };
                p.Controls.AddRange(new Control[] { l, box, browse });
                y += 62;
            }
            Row("Program folder", installBox, true, !o.Upgrade);
            Row("Data folder (database, uploaded files, backups, settings)", dataBox, true, !o.Upgrade);

            bool fresh = !o.DataReady;
            var portLabel = Brand.Text("Web address port", Brand.Small, Brand.Muted);
            portLabel.Location = new Point(28, y);
            portBox.Bounds = new Rectangle(28, y + 20, 90, 26);
            portBox.Enabled = fresh;
            var portHint = Brand.Text(fresh ? "People open http://this-computer:" + portBox.Value : "Kept from the existing server settings.", Brand.Small, Brand.Muted);
            portHint.Location = new Point(128, y + 24);
            portBox.ValueChanged += (s, e) => portHint.Text = "People open http://this-computer:" + portBox.Value;
            p.Controls.AddRange(new Control[] { portLabel, portBox, portHint });
            y += 62;
            foreach (var cb in new[] { networkBox, desktopBox, autoStartBox })
            {
                cb.AutoSize = true;
                cb.Location = new Point(28, y);
                p.Controls.Add(cb);
                y += 28;
            }
            networkBox.Enabled = fresh;
            return p;
        }

        Panel AdminPage()
        {
            var p = NewPage("Administrator account", "The first person to sign in. They can add everyone else from the Users page.");
            admin.Location = new Point(28, 110);
            p.Controls.Add(admin);
            return p;
        }

        Panel InstallPage()
        {
            var p = NewPage(o.Upgrade ? "Updating" : "Installing", null);
            stepLabel.Location = new Point(28, 70);
            bar.Location = new Point(28, 100);
            log.Location = new Point(28, 130);
            p.Controls.AddRange(new Control[] { stepLabel, bar, log });
            return p;
        }

        Panel FinishPage()
        {
            var p = NewPage("MICO360 Tasks Server is ready", null);
            var paths = o.Paths;
            var body = Brand.Text(
                "Open it any time from the Start menu (" + Product.Name + ") or the tray icon.\n\n" +
                "On this computer: http://localhost:" + (o.DataReady ? new ServerManager(paths).HttpPort : o.Port) + "\n" +
                (o.AllowNetwork ? "Other computers and phones: use this computer's network address — the tray icon shows it (Office network address…). If Windows asks whether Node.js may use the network, allow private networks.\n\n" : "\n") +
                "Your data is stored in:\n" + paths.DataDir + "\nBack it up with the tray icon's \"Back up the database now\", and keep the uploads folder too.");
            body.Location = new Point(28, 70);
            launchBox.AutoSize = true;
            launchBox.Location = new Point(28, 330);
            p.Controls.AddRange(new Control[] { body, launchBox });
            return p;
        }

        void Show(int index)
        {
            if (index == 2 && o.DataReady) index = page < 2 ? 3 : 1; // no admin page when a database exists
            page = index;
            content.Controls.Clear();
            content.Controls.Add(pages[index]());
            back.Visible = index > 0 && index < 3;
            next.Text = index == 4 ? "Finish" : index == 2 || (index == 1 && o.DataReady) ? (o.Upgrade ? "Update" : "Install") : "Next >";
            cancel.Visible = index < 4;
            next.Enabled = index != 3;
            if (index == 2) admin.FocusFirstEmpty();
            if (index == 3) BeginInstall();
        }

        void Next()
        {
            if (page == 1)
            {
                o.InstallDir = installBox.Text.Trim();
                o.DataDir = dataBox.Text.Trim();
                o.Port = (int)portBox.Value;
                o.AllowNetwork = networkBox.Checked;
                o.Desktop = desktopBox.Checked;
                o.AutoStart = autoStartBox.Checked;
                var problem = Installer.CheckOptions(o);
                if (problem != null) { MessageBox.Show(this, problem, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
            }
            if (page == 2)
            {
                var account = admin.Read(out var error);
                if (account == null) { MessageBox.Show(this, error, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
                o.Admin = account;
            }
            if (page == 4)
            {
                finished = true;
                if (launchBox.Checked)
                    System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(o.Paths.LauncherExe) { UseShellExecute = false, WorkingDirectory = o.InstallDir });
                Close();
                return;
            }
            Show(page + 1);
        }

        void BeginInstall()
        {
            installing = true;
            o.Launch = false; // the Finish page decides
            var ui = SynchronizationContext.Current;
            void Say(string m) => ui.Post(_ => { stepLabel.Text = m; log.AppendText(m + Environment.NewLine); }, null);
            void Pct(int v) => ui.Post(_ =>
            {
                if (v < 0) { bar.Style = ProgressBarStyle.Marquee; bar.MarqueeAnimationSpeed = 30; }
                else { bar.Style = ProgressBarStyle.Continuous; bar.Value = Math.Min(100, v); }
            }, null);
            new Thread(() =>
            {
                Exception failure = null;
                try { Installer.Run(o, Say, Pct); } catch (Exception e) { failure = e; }
                ui.Post(_ =>
                {
                    installing = false;
                    if (failure != null)
                    {
                        Say("Error: " + failure.Message);
                        Dialogs.Error(this, (failure is ServerException ? failure.Message : "Setup failed: " + failure.Message) +
                            "\n\nYou can run Setup again after fixing the problem.", o.Paths.LogsDir);
                        finished = true;
                        cancel.Text = "Close";
                        cancel.Visible = true;
                        return;
                    }
                    finished = true;
                    Show(4);
                }, null);
            }) { IsBackground = true }.Start();
        }
    }
}
