// MICO360 Tasks Server for Windows — shared core used by Setup, the launcher and Uninstall.
// Runs the bundled MySQL and Node.js, creates the database on first run, applies migrations on
// every start, and serves the API + web app from one port.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace Mico360.Server
{
    public static class Product
    {
        public const string Name = "MICO360 Tasks Server";
        public const string Version = "0.2.0";
        public const string Publisher = "MICO360";
        public const string RegistryKey = "MICO360TasksServer";
        public const string LauncherExe = "MICO360 Tasks Server.exe";
        public const string UninstallExe = "Uninstall.exe";
        public const string MutexName = @"Local\MICO360TasksServer.Instance";
        public const string StopEventName = @"Local\MICO360TasksServer.Stop";
        public const string OpenEventName = @"Local\MICO360TasksServer.Open";
        public const string DatabaseName = "mico360";
        public const string DatabaseUser = "mico360";
        public const int DefaultHttpPort = 4000;
        public const int DefaultMysqlPort = 3307;
    }

    /// <summary>Where the program files and the data live.</summary>
    public sealed class ServerPaths
    {
        public string InstallDir { get; }
        public string DataDir { get; }

        public ServerPaths(string installDir, string dataDir)
        {
            InstallDir = Path.GetFullPath(installDir);
            DataDir = Path.GetFullPath(dataDir);
        }

        static string LocalAppData => Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        public static string DefaultInstallDir => Path.Combine(LocalAppData, "Programs", "MICO360 Tasks Server");
        public static string DefaultDataDir => Path.Combine(LocalAppData, "MICO360 Tasks Server");

        /// <summary>The paths of an installation; the data folder is recorded in datadir.txt by Setup.</summary>
        public static ServerPaths ForInstall(string installDir)
        {
            var marker = Path.Combine(installDir, "datadir.txt");
            var data = File.Exists(marker) ? File.ReadAllText(marker).Trim() : "";
            return new ServerPaths(installDir, string.IsNullOrEmpty(data) ? DefaultDataDir : data);
        }

        public string DataDirMarker => Path.Combine(InstallDir, "datadir.txt");
        public string LauncherExe => Path.Combine(InstallDir, Product.LauncherExe);
        public string UninstallExe => Path.Combine(InstallDir, Product.UninstallExe);
        public string NodeExe => Path.Combine(InstallDir, "node", "node.exe");
        public string MysqlBase => Path.Combine(InstallDir, "mysql");
        public string MysqlBin => Path.Combine(MysqlBase, "bin");
        public string BackendDir => Path.Combine(InstallDir, "app", "backend");
        public string WebDir => Path.Combine(InstallDir, "app", "web");
        public string ConfigDir => Path.Combine(DataDir, "config");
        public string ServerEnv => Path.Combine(ConfigDir, "server.env");
        public string MyIni => Path.Combine(ConfigDir, "my.ini");
        public string MysqlAdminCnf => Path.Combine(ConfigDir, "mysql-admin.cnf");
        public string MysqlDataDir => Path.Combine(DataDir, "mysql");
        public string UploadsDir => Path.Combine(DataDir, "uploads");
        public string LogsDir => Path.Combine(DataDir, "logs");
        public string BackupsDir => Path.Combine(DataDir, "backups");
        public string RunDir => Path.Combine(DataDir, "run");
        public string MysqlPidFile => Path.Combine(RunDir, "mysqld.pid");
    }

    /// <summary>A KEY=VALUE settings file (server.env) that keeps comments and order when saved.</summary>
    public sealed class EnvFile
    {
        readonly List<string> lines;

        EnvFile(List<string> lines) { this.lines = lines; }

        public static EnvFile Load(string path) => new EnvFile(File.ReadAllLines(path, Encoding.UTF8).ToList());
        public static EnvFile Empty() => new EnvFile(new List<string>());

        static readonly Regex Line = new Regex(@"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$");

        public string Get(string key)
        {
            foreach (var l in lines)
            {
                var m = Line.Match(l);
                if (m.Success && m.Groups[1].Value == key) return Unquote(m.Groups[2].Value.Trim());
            }
            return null;
        }

        public int GetInt(string key, int fallback) => int.TryParse(Get(key), out var v) ? v : fallback;

        public void Set(string key, string value)
        {
            var text = key + "=" + Quote(value);
            for (int i = 0; i < lines.Count; i++)
            {
                var m = Line.Match(lines[i]);
                if (m.Success && m.Groups[1].Value == key) { lines[i] = text; return; }
            }
            lines.Add(text);
        }

        public void Comment(string text) => lines.Add("# " + text);
        public void Blank() => lines.Add("");

        public Dictionary<string, string> ToDictionary()
        {
            var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var l in lines)
            {
                var m = Line.Match(l);
                if (m.Success) d[m.Groups[1].Value] = Unquote(m.Groups[2].Value.Trim());
            }
            return d;
        }

        public void Save(string path)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            var tmp = path + ".tmp";
            File.WriteAllLines(tmp, lines, new UTF8Encoding(false));
            if (File.Exists(path)) File.Replace(tmp, path, null);
            else File.Move(tmp, path);
        }

        static string Unquote(string v)
        {
            if (v.Length >= 2 && v[0] == '"' && v[v.Length - 1] == '"')
                return v.Substring(1, v.Length - 2).Replace("\\\"", "\"").Replace("\\\\", "\\");
            if (v.Length >= 2 && v[0] == '\'' && v[v.Length - 1] == '\'') return v.Substring(1, v.Length - 2);
            var hash = v.IndexOf(" #", StringComparison.Ordinal);
            return hash >= 0 ? v.Substring(0, hash).TrimEnd() : v;
        }

        static string Quote(string v)
        {
            if (string.IsNullOrEmpty(v)) return "";
            if (v.All(c => char.IsLetterOrDigit(c) || "-_.:/@,*+".IndexOf(c) >= 0)) return v;
            return "\"" + v.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
        }
    }

    public sealed class AdminAccount
    {
        public string Email;
        public string Username;
        public string Password;
        public string FirstName = "Admin";
        public string LastName = "User";

        /// <summary>Same rules as the web app: a valid email, a simple username, 8+ characters with a letter and a digit.</summary>
        public string Validate()
        {
            if (string.IsNullOrWhiteSpace(Email) || !Regex.IsMatch(Email.Trim(), @"^[^@\s]+@[^@\s]+\.[^@\s]+$")) return "Enter a valid email address.";
            if (string.IsNullOrWhiteSpace(Username) || !Regex.IsMatch(Username.Trim(), @"^[A-Za-z0-9._-]{3,50}$"))
                return "The username must be 3–50 letters, digits, dots, dashes or underscores.";
            // Same rule as the API's isStrongPassword: 8+ characters, an A–Z letter and a 0–9 digit.
            if (Password == null || Password.Length < 8 || !Password.Any(c => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) || !Password.Any(c => c >= '0' && c <= '9'))
                return "The password must be at least 8 characters and contain a letter (A–Z) and a digit.";
            if (string.IsNullOrWhiteSpace(FirstName) || string.IsNullOrWhiteSpace(LastName)) return "Enter the administrator's first and last name.";
            return null;
        }
    }

    public sealed class InitOptions
    {
        public AdminAccount Admin;
        public int HttpPort = Product.DefaultHttpPort;
        public bool AllowNetwork = true;
        public string TimeZone = "Asia/Muscat";
    }

    public sealed class ServerException : Exception
    {
        public ServerException(string message) : base(message) { }
        public ServerException(string message, Exception inner) : base(message, inner) { }
    }

    /// <summary>Starts, stops and sets up the bundled MySQL + Node.js server.</summary>
    public sealed class ServerManager : IDisposable
    {
        public ServerPaths Paths { get; }
        /// <summary>Progress messages for the user (setup / start-up windows).</summary>
        public event Action<string> Progress;

        Process mysqld;
        Process node;
        JobObject job;
        StreamWriter serverLog;
        readonly object logLock = new object();
        volatile bool stopping;

        public ServerManager(ServerPaths paths) { Paths = paths; }

        void Report(string message)
        {
            Log("launcher", message);
            Progress?.Invoke(message);
        }

        /// <summary>Append a line to logs\launcher.log (never throws).</summary>
        public void Log(string source, string message)
        {
            try
            {
                Directory.CreateDirectory(Paths.LogsDir);
                lock (logLock)
                    File.AppendAllText(Path.Combine(Paths.LogsDir, "launcher.log"),
                        DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " [" + source + "] " + message + Environment.NewLine);
            }
            catch { }
        }

        public bool IsInitialized => File.Exists(Paths.ServerEnv) && Directory.Exists(Path.Combine(Paths.MysqlDataDir, "mysql"));

        public EnvFile LoadConfig()
        {
            if (!File.Exists(Paths.ServerEnv)) throw new ServerException("The server has not been set up yet (" + Paths.ServerEnv + " is missing).");
            return EnvFile.Load(Paths.ServerEnv);
        }

        public int HttpPort => LoadConfig().GetInt("PORT", Product.DefaultHttpPort);
        public bool NodeRunning => node != null && !node.HasExited;
        public int? NodeExitCode => node != null && node.HasExited ? node.ExitCode : (int?)null;
        public string LocalUrl => "http://localhost:" + HttpPort;

        /// <summary>The address other computers and phones on the office network use, when network access is on.</summary>
        public string NetworkUrl
        {
            get
            {
                var cfg = LoadConfig();
                if ((cfg.Get("HOST") ?? "0.0.0.0") != "0.0.0.0") return null;
                var ip = LanAddress();
                return ip == null ? null : "http://" + ip + ":" + cfg.GetInt("PORT", Product.DefaultHttpPort);
            }
        }

        // ---------------------------------------------------------------- first-time setup

        public void Initialize(InitOptions o)
        {
            var problem = o.Admin?.Validate();
            if (problem != null) throw new ServerException(problem);
            if (IsInitialized) throw new ServerException("This data folder already contains a MICO360 Tasks database.");
            CheckProgramFiles();
            Report("Preparing the data folder…");
            foreach (var d in new[] { Paths.ConfigDir, Paths.UploadsDir, Paths.LogsDir, Paths.BackupsDir, Paths.RunDir }) Directory.CreateDirectory(d);
            if (Directory.Exists(Paths.MysqlDataDir) && Directory.EnumerateFileSystemEntries(Paths.MysqlDataDir).Any())
            {
                // Left over from an interrupted setup: keep it aside rather than delete anything.
                var aside = Paths.MysqlDataDir + ".incomplete-" + DateTime.Now.ToString("yyyyMMddHHmmss");
                Directory.Move(Paths.MysqlDataDir, aside);
                Log("launcher", "Moved an incomplete database folder to " + aside);
            }
            if (!PortFree(o.HttpPort)) throw new ServerException("Port " + o.HttpPort + " is already used by another program. Choose a different port.");
            int mysqlPort = Product.DefaultMysqlPort;
            while (!PortFree(mysqlPort)) mysqlPort++;
            WriteMyIni(mysqlPort);

            Report("Creating the database (this takes about a minute)…");
            var init = RunTool(Path.Combine(Paths.MysqlBin, "mysqld.exe"),
                "--defaults-file=" + Q(Paths.MyIni) + " --initialize-insecure --console", Paths.MysqlBin, null, 300);
            File.WriteAllText(Path.Combine(Paths.LogsDir, "mysql-init.log"), init.Output);
            if (init.ExitCode != 0) throw new ServerException("MySQL could not create its data folder. See " + Path.Combine(Paths.LogsDir, "mysql-init.log") + ".");

            string rootPassword = RandomSecret(24), appPassword = RandomSecret(24);
            StartMysql(mysqlPort);
            try
            {
                Report("Securing the database…");
                RunSql(mysqlPort, null,
                    "ALTER USER 'root'@'localhost' IDENTIFIED BY '" + rootPassword + "';\n" +
                    "CREATE DATABASE `" + Product.DatabaseName + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n" +
                    "CREATE USER '" + Product.DatabaseUser + "'@'localhost' IDENTIFIED BY '" + appPassword + "';\n" +
                    "CREATE USER '" + Product.DatabaseUser + "'@'127.0.0.1' IDENTIFIED BY '" + appPassword + "';\n" +
                    "GRANT ALL PRIVILEGES ON `" + Product.DatabaseName + "`.* TO '" + Product.DatabaseUser + "'@'localhost';\n" +
                    "GRANT ALL PRIVILEGES ON `" + Product.DatabaseName + "`.* TO '" + Product.DatabaseUser + "'@'127.0.0.1';\n" +
                    "FLUSH PRIVILEGES;\n");
                File.WriteAllText(Paths.MysqlAdminCnf, "[client]\r\nuser=root\r\npassword=\"" + rootPassword + "\"\r\n", new UTF8Encoding(false));

                var cfg = NewConfig(o, mysqlPort, appPassword);
                cfg.Save(Paths.ServerEnv);

                Report("Creating the tables…");
                RunMigrations(cfg);

                Report("Creating the administrator account…");
                var env = ServerEnvironment(cfg);
                env["ADMIN_EMAIL"] = o.Admin.Email.Trim();
                env["ADMIN_USERNAME"] = o.Admin.Username.Trim();
                env["ADMIN_PASSWORD"] = o.Admin.Password;
                env["ADMIN_FIRST_NAME"] = o.Admin.FirstName.Trim();
                env["ADMIN_LAST_NAME"] = o.Admin.LastName.Trim();
                var boot = RunTool(Paths.NodeExe, Q(Path.Combine("dist", "src", "scripts", "bootstrap.js")), Paths.BackendDir, env, 120);
                Log("bootstrap", boot.Output.Trim());
                if (boot.ExitCode != 0) throw new ServerException("The administrator account could not be created:\n" + LastLines(boot.Output, 6));
            }
            catch
            {
                // Setup failed: don't leave a half-configured server that looks ready.
                StopMysql();
                if (File.Exists(Paths.ServerEnv)) File.Move(Paths.ServerEnv, Paths.ServerEnv + ".failed-" + DateTime.Now.ToString("yyyyMMddHHmmss"));
                throw;
            }
            StopMysql();
            Report("The database is ready.");
        }

        EnvFile NewConfig(InitOptions o, int mysqlPort, string appPassword)
        {
            var cfg = EnvFile.Empty();
            string site = "http://localhost:" + o.HttpPort;
            string lan = o.AllowNetwork ? LanAddress() : null;
            cfg.Comment("MICO360 Tasks Server settings. Restart the server (tray icon → Restart) after editing.");
            cfg.Comment("Keep this file private: it holds the database password and the sign-in secrets.");
            cfg.Blank();
            cfg.Set("NODE_ENV", "production");
            cfg.Comment("Web address port, and who may connect: 0.0.0.0 = this computer and the office network, 127.0.0.1 = this computer only.");
            cfg.Set("PORT", o.HttpPort.ToString());
            cfg.Set("HOST", o.AllowNetwork ? "0.0.0.0" : "127.0.0.1");
            cfg.Comment("Address used in emailed links (password reset). Use the address people open, e.g. http://192.168.1.20:" + o.HttpPort);
            cfg.Set("APP_URL", lan != null ? "http://" + lan + ":" + o.HttpPort : site);
            cfg.Set("API_BASE_URL", lan != null ? "http://" + lan + ":" + o.HttpPort : site);
            cfg.Comment("Other web origins allowed to call the API (the Chrome extension is allowed by chrome-extension://*).");
            cfg.Set("CORS_ORIGINS", site + ",http://127.0.0.1:" + o.HttpPort + ",chrome-extension://*");
            cfg.Set("TRUST_PROXY", "false");
            cfg.Set("COMPANY_TIMEZONE", o.TimeZone);
            cfg.Blank();
            cfg.Comment("Database (bundled MySQL, reachable from this computer only).");
            cfg.Set("DATABASE_URL", "mysql://" + Product.DatabaseUser + ":" + appPassword + "@127.0.0.1:" + mysqlPort + "/" + Product.DatabaseName);
            cfg.Set("MICO360_MYSQL_PORT", mysqlPort.ToString());
            cfg.Blank();
            cfg.Comment("Sign-in secrets — generated for this server; changing them signs everyone out.");
            cfg.Set("JWT_ACCESS_SECRET", RandomSecret(48));
            cfg.Set("JWT_REFRESH_SECRET", RandomSecret(48));
            cfg.Set("SECRETS_ENCRYPTION_KEY", RandomSecret(48));
            cfg.Blank();
            cfg.Comment("Email (Mailjet). Without keys the app works, but sign-in codes, password-reset emails and meeting invitations are off.");
            cfg.Set("MAILJET_API_KEY", "");
            cfg.Set("MAILJET_SECRET_KEY", "");
            cfg.Set("MAIL_FROM", "MICO360 Tasks <no-reply@mico360.com>");
            cfg.Set("MAILJET_WEBHOOK_TOKEN", "");
            cfg.Blank();
            cfg.Comment("Branding used in emails.");
            cfg.Set("COMPANY_NAME", "MICO360");
            cfg.Set("PRODUCT_NAME", "MICO360 Tasks");
            cfg.Blank();
            cfg.Comment("Optional: folder for uploaded files (default: the uploads folder next to this config folder).");
            cfg.Set("UPLOAD_DIR", "");
            return cfg;
        }

        void WriteMyIni(int port)
        {
            string F(string p) => p.Replace('\\', '/');
            var ini = new StringBuilder();
            ini.AppendLine("# Bundled MySQL for MICO360 Tasks Server — reachable from this computer only.");
            ini.AppendLine("[mysqld]");
            ini.AppendLine("basedir=\"" + F(Paths.MysqlBase) + "\"");
            ini.AppendLine("datadir=\"" + F(Paths.MysqlDataDir) + "\"");
            ini.AppendLine("port=" + port);
            ini.AppendLine("bind-address=127.0.0.1");
            ini.AppendLine("mysqlx=OFF");
            ini.AppendLine("character-set-server=utf8mb4");
            ini.AppendLine("collation-server=utf8mb4_unicode_ci");
            ini.AppendLine("default-time-zone='+00:00'");
            ini.AppendLine("max_connections=200");
            ini.AppendLine("innodb_buffer_pool_size=256M");
            ini.AppendLine("log-error=\"" + F(Path.Combine(Paths.LogsDir, "mysql-error.log")) + "\"");
            ini.AppendLine("pid-file=\"" + F(Paths.MysqlPidFile) + "\"");
            ini.AppendLine("lc-messages-dir=\"" + F(Path.Combine(Paths.MysqlBase, "share")) + "\"");
            ini.AppendLine("secure-file-priv=\"" + F(Paths.RunDir) + "\"");
            Directory.CreateDirectory(Paths.ConfigDir);
            File.WriteAllText(Paths.MyIni, ini.ToString(), new UTF8Encoding(false));
        }

        // ---------------------------------------------------------------- start / stop

        /// <summary>Start MySQL, apply migrations and start the web server; returns when it answers.</summary>
        public void Start()
        {
            stopping = false;
            CheckProgramFiles();
            var cfg = LoadConfig();
            int port = cfg.GetInt("PORT", Product.DefaultHttpPort);
            int mysqlPort = cfg.GetInt("MICO360_MYSQL_PORT", Product.DefaultMysqlPort);
            // my.ini holds absolute paths: rewrite it every start, so a data folder moved to another
            // computer (or a reinstall into a different program folder) still starts.
            WriteMyIni(mysqlPort);
            foreach (var d in new[] { Paths.UploadsDir, Paths.LogsDir, Paths.BackupsDir, Paths.RunDir }) Directory.CreateDirectory(d);

            if (!PortFree(port)) throw new ServerException("Port " + port + " is already used by another program. Close it, or change PORT in " + Paths.ServerEnv + ".");

            Report("Starting the database…");
            if (!MysqlAnswers(mysqlPort)) StartMysql(mysqlPort);
            else Log("launcher", "MySQL is already running on port " + mysqlPort + " — reusing it.");

            Report("Checking for database updates…");
            RunMigrations(cfg);

            Report("Starting MICO360 Tasks…");
            StartNode(cfg);
            WaitForHealth(port, TimeSpan.FromSeconds(90));
            Report("MICO360 Tasks is running at " + LocalUrl);
        }

        /// <summary>Restart only the web server (e.g. after it stopped unexpectedly or settings changed).</summary>
        public void RestartNode()
        {
            StopNode();
            var cfg = LoadConfig();
            int port = cfg.GetInt("PORT", Product.DefaultHttpPort);
            int mysqlPort = cfg.GetInt("MICO360_MYSQL_PORT", Product.DefaultMysqlPort);
            if (!MysqlAnswers(mysqlPort)) StartMysql(mysqlPort);
            StartNode(cfg);
            WaitForHealth(port, TimeSpan.FromSeconds(90));
        }

        public void Stop()
        {
            stopping = true;
            StopNode();
            StopMysql();
            Report("Stopped.");
        }

        void StartNode(EnvFile cfg)
        {
            RotateLog(Path.Combine(Paths.LogsDir, "server.log"));
            serverLog = new StreamWriter(new FileStream(Path.Combine(Paths.LogsDir, "server.log"), FileMode.Append, FileAccess.Write, FileShare.ReadWrite), new UTF8Encoding(false)) { AutoFlush = true };
            var psi = NewStartInfo(Paths.NodeExe, Q(Path.Combine("dist", "src", "server.js")), Paths.BackendDir, ServerEnvironment(cfg));
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            node = new Process { StartInfo = psi, EnableRaisingEvents = true };
            node.OutputDataReceived += (s, e) => WriteServerLog(e.Data);
            node.ErrorDataReceived += (s, e) => WriteServerLog(e.Data);
            node.Start();
            // The web server must never outlive the launcher (even if the launcher is killed).
            if (job == null) job = new JobObject();
            job.Add(node);
            node.BeginOutputReadLine();
            node.BeginErrorReadLine();
            Log("launcher", "Started node (pid " + node.Id + ").");
        }

        void WriteServerLog(string line)
        {
            if (line == null) return;
            try { lock (logLock) serverLog?.WriteLine(line); } catch { }
        }

        void StopNode()
        {
            if (node == null) return;
            try
            {
                if (!node.HasExited)
                {
                    node.Kill();
                    node.WaitForExit(15000);
                }
            }
            catch (Exception e) { Log("launcher", "Stopping node: " + e.Message); }
            node.Dispose();
            node = null;
            lock (logLock) { serverLog?.Dispose(); serverLog = null; }
        }

        void StartMysql(int port)
        {
            if (!PortFree(port)) throw new ServerException("Port " + port + " (database) is used by another program. Change MICO360_MYSQL_PORT and my.ini, or close that program.");
            var psi = NewStartInfo(Path.Combine(Paths.MysqlBin, "mysqld.exe"), "--defaults-file=" + Q(Paths.MyIni), Paths.MysqlBin, null);
            mysqld = Process.Start(psi);
            Log("launcher", "Started mysqld (pid " + mysqld.Id + ") on port " + port + ".");
            var deadline = DateTime.UtcNow.AddSeconds(120);
            while (DateTime.UtcNow < deadline)
            {
                if (mysqld.HasExited)
                    throw new ServerException("The database stopped while starting. See " + Path.Combine(Paths.LogsDir, "mysql-error.log") + ".");
                if (MysqlAnswers(port)) return;
                Thread.Sleep(500);
            }
            throw new ServerException("The database did not start within two minutes. See " + Path.Combine(Paths.LogsDir, "mysql-error.log") + ".");
        }

        /// <summary>Shut MySQL down cleanly (also one left running by an earlier session).</summary>
        public void StopMysql()
        {
            int port = Product.DefaultMysqlPort;
            try { if (File.Exists(Paths.ServerEnv)) port = LoadConfig().GetInt("MICO360_MYSQL_PORT", port); } catch { }
            var running = mysqld != null && !mysqld.HasExited ? mysqld : ProcessFromPidFile(Paths.MysqlPidFile, "mysqld");
            if (running == null && !MysqlAnswers(port)) return;
            if (File.Exists(Paths.MysqlAdminCnf))
            {
                var r = RunTool(Path.Combine(Paths.MysqlBin, "mysqladmin.exe"),
                    "--defaults-extra-file=" + Q(Paths.MysqlAdminCnf) + " --host=127.0.0.1 --port=" + port + " --protocol=TCP shutdown", Paths.MysqlBin, null, 60);
                if (r.ExitCode != 0) Log("mysqladmin", r.Output.Trim());
            }
            else
            {
                // Before the root password is set (interrupted setup), root has no password.
                RunTool(Path.Combine(Paths.MysqlBin, "mysqladmin.exe"), "--user=root --host=127.0.0.1 --port=" + port + " --protocol=TCP shutdown", Paths.MysqlBin, null, 60);
            }
            if (running != null)
            {
                if (!running.WaitForExit(60000))
                {
                    Log("launcher", "MySQL did not shut down in time — ending it.");
                    try { running.Kill(); running.WaitForExit(10000); } catch { }
                }
            }
            else
            {
                var until = DateTime.UtcNow.AddSeconds(60);
                while (MysqlAnswers(port) && DateTime.UtcNow < until) Thread.Sleep(500);
            }
            mysqld = null;
        }

        /// <summary>Whether a MySQL server answers on this port (mysqladmin ping reports "alive" even without credentials).</summary>
        bool MysqlAnswers(int port)
        {
            if (PortFree(port)) return false;
            var r = RunTool(Path.Combine(Paths.MysqlBin, "mysqladmin.exe"), "--host=127.0.0.1 --port=" + port + " --protocol=TCP --connect-timeout=3 ping", Paths.MysqlBin, null, 15);
            return r.ExitCode == 0;
        }

        void RunMigrations(EnvFile cfg)
        {
            var env = ServerEnvironment(cfg);
            var r = RunTool(Paths.NodeExe,
                Q(Path.Combine("node_modules", "prisma", "build", "index.js")) + " migrate deploy --schema " + Q(Path.Combine("prisma", "schema.prisma")),
                Paths.BackendDir, env, 300);
            File.AppendAllText(Path.Combine(Paths.LogsDir, "migrate.log"), DateTime.Now.ToString("s") + Environment.NewLine + r.Output + Environment.NewLine);
            if (r.ExitCode != 0) throw new ServerException("Updating the database failed:\n" + LastLines(r.Output, 8));
        }

        void WaitForHealth(int port, TimeSpan timeout)
        {
            var deadline = DateTime.UtcNow + timeout;
            while (DateTime.UtcNow < deadline)
            {
                if (node == null || node.HasExited)
                    throw new ServerException("MICO360 Tasks stopped while starting:\n" + LastLines(TailFile(Path.Combine(Paths.LogsDir, "server.log"), 4000), 8));
                if (Healthy(port)) return;
                Thread.Sleep(500);
            }
            throw new ServerException("MICO360 Tasks did not start within " + (int)timeout.TotalSeconds + " seconds. See " + Path.Combine(Paths.LogsDir, "server.log") + ".");
        }

        public static bool Healthy(int port)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/v1/health");
                req.Timeout = 3000;
                req.Proxy = null;
                using (var res = (HttpWebResponse)req.GetResponse())
                using (var sr = new StreamReader(res.GetResponseStream()))
                    return res.StatusCode == HttpStatusCode.OK && sr.ReadToEnd().Contains("\"ok\"");
            }
            catch { return false; }
        }

        /// <summary>The environment for node: the settings file plus the paths of this installation.</summary>
        public Dictionary<string, string> ServerEnvironment(EnvFile cfg)
        {
            var env = cfg.ToDictionary();
            env.Remove("MICO360_MYSQL_PORT");
            env["NODE_ENV"] = "production";
            env["WEB_ROOT"] = Paths.WebDir;
            if (!env.TryGetValue("UPLOAD_DIR", out var up) || string.IsNullOrWhiteSpace(up)) env["UPLOAD_DIR"] = Paths.UploadsDir;
            // Keep the Prisma CLI offline and quiet.
            env["CHECKPOINT_DISABLE"] = "1";
            env["PRISMA_HIDE_UPDATE_MESSAGE"] = "1";
            return env;
        }

        // ---------------------------------------------------------------- maintenance

        /// <summary>Write a full SQL dump of the database to backups\ and return its path.</summary>
        public string BackupDatabase()
        {
            var cfg = LoadConfig();
            int port = cfg.GetInt("MICO360_MYSQL_PORT", Product.DefaultMysqlPort);
            if (!MysqlAnswers(port)) throw new ServerException("The database is not running.");
            Directory.CreateDirectory(Paths.BackupsDir);
            var file = Path.Combine(Paths.BackupsDir, "mico360-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".sql");
            var r = RunTool(Path.Combine(Paths.MysqlBin, "mysqldump.exe"),
                "--defaults-extra-file=" + Q(Paths.MysqlAdminCnf) + " --host=127.0.0.1 --port=" + port +
                " --protocol=TCP --single-transaction --routines --triggers --default-character-set=utf8mb4 --result-file=" + Q(file) + " " + Product.DatabaseName,
                Paths.MysqlBin, null, 600);
            if (r.ExitCode != 0 || !File.Exists(file)) throw new ServerException("The backup failed:\n" + LastLines(r.Output, 6));
            Log("launcher", "Database backup written to " + file);
            return file;
        }

        void CheckProgramFiles()
        {
            foreach (var f in new[] { Paths.NodeExe, Path.Combine(Paths.MysqlBin, "mysqld.exe"), Path.Combine(Paths.BackendDir, "dist", "src", "server.js"), Path.Combine(Paths.WebDir, "index.html") })
                if (!File.Exists(f)) throw new ServerException("A program file is missing: " + f + "\nPlease reinstall MICO360 Tasks Server.");
        }

        public void Dispose()
        {
            if (!stopping) { try { Stop(); } catch { } }
            job?.Dispose();
        }

        // ---------------------------------------------------------------- helpers

        public sealed class ToolResult { public int ExitCode; public string Output; }

        static ProcessStartInfo NewStartInfo(string exe, string args, string cwd, IDictionary<string, string> env)
        {
            var psi = new ProcessStartInfo(exe, args)
            {
                WorkingDirectory = cwd,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            psi.EnvironmentVariables.Remove("NODE_OPTIONS");
            if (env != null) foreach (var kv in env) psi.EnvironmentVariables[kv.Key] = kv.Value ?? "";
            return psi;
        }

        /// <summary>Run a program to completion, capturing its output.</summary>
        public static ToolResult RunTool(string exe, string args, string cwd, IDictionary<string, string> env, int timeoutSeconds)
        {
            var psi = NewStartInfo(exe, args, cwd, env);
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            var output = new StringBuilder();
            using (var p = new Process { StartInfo = psi })
            {
                p.OutputDataReceived += (s, e) => { if (e.Data != null) lock (output) output.AppendLine(e.Data); };
                p.ErrorDataReceived += (s, e) => { if (e.Data != null) lock (output) output.AppendLine(e.Data); };
                p.Start();
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                if (!p.WaitForExit(timeoutSeconds * 1000))
                {
                    try { p.Kill(); } catch { }
                    lock (output) output.AppendLine("(timed out after " + timeoutSeconds + " s)");
                    return new ToolResult { ExitCode = -1, Output = output.ToString() };
                }
                p.WaitForExit();
                lock (output) return new ToolResult { ExitCode = p.ExitCode, Output = output.ToString() };
            }
        }

        void RunSql(int port, string password, string sql)
        {
            var file = Path.Combine(Paths.RunDir, "setup-" + Guid.NewGuid().ToString("N") + ".sql");
            File.WriteAllText(file, sql, new UTF8Encoding(false));
            try
            {
                var args = "--user=root " + (password != null ? "--password=" + Q(password) + " " : "") +
                           "--host=127.0.0.1 --port=" + port + " --protocol=TCP --default-character-set=utf8mb4 --execute=" + Q("source " + file.Replace('\\', '/'));
                var r = RunTool(Path.Combine(Paths.MysqlBin, "mysql.exe"), args, Paths.MysqlBin, null, 120);
                if (r.ExitCode != 0) throw new ServerException("Setting up the database failed:\n" + LastLines(r.Output, 6));
            }
            finally { try { File.Delete(file); } catch { } }
        }

        static Process ProcessFromPidFile(string pidFile, string expectedName)
        {
            try
            {
                if (!File.Exists(pidFile)) return null;
                var p = Process.GetProcessById(int.Parse(File.ReadAllText(pidFile).Trim()));
                return string.Equals(p.ProcessName, expectedName, StringComparison.OrdinalIgnoreCase) && !p.HasExited ? p : null;
            }
            catch { return null; }
        }

        public static bool PortFree(int port)
        {
            try
            {
                using (var c = new TcpClient())
                {
                    var ar = c.BeginConnect(IPAddress.Loopback, port, null, null);
                    if (ar.AsyncWaitHandle.WaitOne(700) && c.Connected) return false;
                }
            }
            catch { }
            var listeners = IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners();
            return !listeners.Any(l => l.Port == port);
        }

        /// <summary>This computer's address on the office network (a private IPv4 address), if any.</summary>
        public static string LanAddress()
        {
            try
            {
                var candidates = NetworkInterface.GetAllNetworkInterfaces()
                    .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                    .Select(n => new { Props = n.GetIPProperties(), n.Description })
                    .Where(n => !Regex.IsMatch(n.Description, "Hyper-V|VirtualBox|VMware|WSL|Loopback|vEthernet", RegexOptions.IgnoreCase))
                    .SelectMany(n => n.Props.UnicastAddresses.Select(a => new { a.Address, HasGateway = n.Props.GatewayAddresses.Any(g => g.Address.AddressFamily == AddressFamily.InterNetwork && !g.Address.Equals(IPAddress.Any)) }))
                    .Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork && IsPrivate(a.Address))
                    .OrderByDescending(a => a.HasGateway)
                    .ToList();
                return candidates.Count > 0 ? candidates[0].Address.ToString() : null;
            }
            catch { return null; }
        }

        static bool IsPrivate(IPAddress ip)
        {
            var b = ip.GetAddressBytes();
            return b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168);
        }

        public static string RandomSecret(int bytes)
        {
            var data = new byte[bytes];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(data);
            // URL- and shell-safe: letters and digits only.
            const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
            var sb = new StringBuilder();
            foreach (var x in data) sb.Append(alphabet[x % alphabet.Length]);
            return sb.ToString();
        }

        static void RotateLog(string file)
        {
            try
            {
                if (File.Exists(file) && new FileInfo(file).Length > 10 * 1024 * 1024)
                {
                    var old = file + ".1";
                    if (File.Exists(old)) File.Delete(old);
                    File.Move(file, old);
                }
            }
            catch { }
        }

        public static string TailFile(string file, int maxChars)
        {
            try
            {
                using (var fs = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                {
                    if (fs.Length > maxChars) fs.Seek(-maxChars, SeekOrigin.End);
                    using (var sr = new StreamReader(fs)) return sr.ReadToEnd();
                }
            }
            catch { return ""; }
        }

        static string LastLines(string text, int n) =>
            string.Join(Environment.NewLine, (text ?? "").Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).Reverse().Take(n).Reverse());

        public static string Q(string s) => "\"" + s + "\"";
    }

    /// <summary>A Windows job object: processes added to it end when the launcher ends, even if it crashes.</summary>
    sealed class JobObject : IDisposable
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimitInformation info, uint length);
        [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

        [StructLayout(LayoutKind.Sequential)]
        struct BasicLimitInformation
        {
            public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass, SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct IoCounters { public ulong a, b, c, d, e, f; }

        [StructLayout(LayoutKind.Sequential)]
        struct ExtendedLimitInformation
        {
            public BasicLimitInformation Basic;
            public IoCounters Io;
            public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
        }

        readonly IntPtr handle;

        public JobObject()
        {
            handle = CreateJobObject(IntPtr.Zero, null);
            var info = new ExtendedLimitInformation();
            info.Basic.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            SetInformationJobObject(handle, 9, ref info, (uint)Marshal.SizeOf(typeof(ExtendedLimitInformation)));
        }

        public void Add(Process p) => AssignProcessToJobObject(handle, p.Handle);

        public void Dispose() => CloseHandle(handle);
    }
}
