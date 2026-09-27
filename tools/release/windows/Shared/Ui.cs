// Shared look and feel for Setup, the launcher and Uninstall (WinForms, .NET Framework 4.x).
using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace Mico360.Server
{
    public static class Brand
    {
        public static readonly Color Red = Color.FromArgb(0x8B, 0x1E, 0x1E);
        public static readonly Color RedDark = Color.FromArgb(0x6E, 0x14, 0x14);
        public static readonly Color Ink = Color.FromArgb(0x1F, 0x23, 0x2B);
        public static readonly Color Muted = Color.FromArgb(0x5B, 0x63, 0x70);
        public static readonly Color Line = Color.FromArgb(0xE3, 0xE6, 0xEB);
        public static readonly Font Body = new Font("Segoe UI", 9.75f);
        public static readonly Font Small = new Font("Segoe UI", 8.75f);
        public static readonly Font Title = new Font("Segoe UI Semibold", 15f);
        public static readonly Font Heading = new Font("Segoe UI Semibold", 11f);

        /// <summary>An image embedded in the running exe (logo-w.png / logo.png), or null.</summary>
        public static Image EmbeddedImage(string name)
        {
            var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
            return s == null ? null : Image.FromStream(s);
        }

        public static Icon AppIcon()
        {
            try { return Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); } catch { return SystemIcons.Application; }
        }

        /// <summary>Lay a form out at 96 DPI and let WinForms scale it to the screen's DPI.</summary>
        public static void ScaleForDpi(Form form)
        {
            form.AutoScaleDimensions = new SizeF(96F, 96F);
            form.AutoScaleMode = AutoScaleMode.Dpi;
        }

        public static Label Text(string text, Font font = null, Color? color = null)
        {
            return new Label
            {
                Text = text,
                Font = font ?? Body,
                ForeColor = color ?? Ink,
                AutoSize = true,
                MaximumSize = new Size(460, 0),
                BackColor = Color.Transparent,
            };
        }
    }

    /// <summary>A small window with a progress bar and a running log, used while working.</summary>
    public sealed class ProgressForm : Form
    {
        readonly Label status;
        readonly ProgressBar bar;
        readonly TextBox details;

        public ProgressForm(string title)
        {
            Brand.ScaleForDpi(this);
            Text = title;
            Icon = Brand.AppIcon();
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = true;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(520, 250);
            BackColor = Color.White;
            Font = Brand.Body;

            var head = new Panel { Dock = DockStyle.Top, Height = 56, BackColor = Brand.Red };
            var logo = Brand.EmbeddedImage("logo-w.png");
            if (logo != null) head.Controls.Add(new PictureBox { Image = logo, SizeMode = PictureBoxSizeMode.Zoom, Bounds = new Rectangle(16, 10, 36, 36), BackColor = Color.Transparent });
            head.Controls.Add(new Label { Text = title, Font = Brand.Heading, ForeColor = Color.White, AutoSize = true, Location = new Point(60, 17), BackColor = Color.Transparent });
            Controls.Add(head);

            status = new Label { Location = new Point(20, 72), Size = new Size(480, 22), Font = Brand.Body, ForeColor = Brand.Ink, Text = "Working…" };
            bar = new ProgressBar { Location = new Point(20, 98), Size = new Size(480, 16), Style = ProgressBarStyle.Marquee, MarqueeAnimationSpeed = 30 };
            details = new TextBox { Location = new Point(20, 124), Size = new Size(480, 108), Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Font = Brand.Small, BackColor = Color.FromArgb(0xF6, 0xF7, 0xF9), BorderStyle = BorderStyle.FixedSingle };
            Controls.AddRange(new Control[] { status, bar, details });
        }

        /// <summary>Thread-safe: show a step.</summary>
        public void Step(string message)
        {
            if (InvokeRequired) { BeginInvoke((Action)(() => Step(message))); return; }
            status.Text = message;
            details.AppendText(message + Environment.NewLine);
        }

        /// <summary>Thread-safe: switch to a determinate bar (0–100) or back to marquee (null).</summary>
        public void Percent(int? value)
        {
            if (InvokeRequired) { BeginInvoke((Action)(() => Percent(value))); return; }
            if (value == null) { bar.Style = ProgressBarStyle.Marquee; return; }
            bar.Style = ProgressBarStyle.Continuous;
            bar.Value = Math.Max(0, Math.Min(100, value.Value));
        }
    }

    public static class Dialogs
    {
        public static void Error(IWin32Window owner, string message, string logsDir = null)
        {
            if (logsDir != null && Directory.Exists(logsDir))
            {
                var r = MessageBox.Show(owner, message + "\n\nOpen the logs folder?", Product.Name, MessageBoxButtons.YesNo, MessageBoxIcon.Error);
                if (r == DialogResult.Yes) Shell.Open(logsDir);
            }
            else MessageBox.Show(owner, message, Product.Name, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    public static class Shell
    {
        /// <summary>Open a URL, folder or file with its default program.</summary>
        public static void Open(string target)
        {
            try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(target) { UseShellExecute = true }); } catch { }
        }
    }

    /// <summary>Lets a GUI exe print to the console it was started from (silent installs, --help).</summary>
    public static class ConsoleOut
    {
        [DllImport("kernel32.dll")] static extern bool AttachConsole(int pid);
        static bool attached;

        public static void Line(string text)
        {
            if (!attached) attached = AttachConsole(-1);
            try { Console.WriteLine(text); } catch { }
        }
    }
}
