// The "first administrator" form fields, shared by Setup and the launcher's first-run dialog.
using System.Drawing;
using System.Windows.Forms;

namespace Mico360.Server
{
    public sealed class AdminFields : Panel
    {
        readonly TextBox first, last, email, username, password, confirm;

        public AdminFields()
        {
            Size = new Size(460, 250);
            BackColor = Color.White;
            first = Field("First name", 0, 0, 220, "Admin");
            last = Field("Last name", 240, 0, 220, "User");
            email = Field("Email", 0, 56, 460, "");
            username = Field("Username", 0, 112, 220, "admin");
            password = Field("Password", 0, 168, 220, "", true);
            confirm = Field("Confirm password", 240, 168, 220, "", true);
            var hint = new Label
            {
                Text = "At least 8 characters, with a letter and a digit. You sign in with the email or username.",
                Font = Brand.Small, ForeColor = Brand.Muted, AutoSize = false, Bounds = new Rectangle(0, 222, 460, 28),
            };
            Controls.Add(hint);
        }

        TextBox Field(string label, int x, int y, int width, string value, bool secret = false)
        {
            Controls.Add(new Label { Text = label, Font = Brand.Small, ForeColor = Brand.Muted, AutoSize = true, Location = new Point(x, y) });
            var tb = new TextBox { Font = Brand.Body, Bounds = new Rectangle(x, y + 20, width, 26), Text = value, UseSystemPasswordChar = secret };
            tb.AccessibleName = label;
            Controls.Add(tb);
            return tb;
        }

        public void FocusFirstEmpty()
        {
            foreach (var tb in new[] { email, password })
                if (string.IsNullOrEmpty(tb.Text)) { tb.Focus(); return; }
        }

        /// <summary>The account, or an error message (and focus on the field to fix).</summary>
        public AdminAccount Read(out string error)
        {
            var a = new AdminAccount
            {
                FirstName = first.Text.Trim(),
                LastName = last.Text.Trim(),
                Email = email.Text.Trim(),
                Username = username.Text.Trim(),
                Password = password.Text,
            };
            error = a.Validate();
            if (error == null && password.Text != confirm.Text) { error = "The two passwords don't match."; confirm.Focus(); }
            else if (error != null)
            {
                if (error.Contains("email")) email.Focus();
                else if (error.Contains("username")) username.Focus();
                else if (error.Contains("password")) password.Focus();
                else first.Focus();
            }
            return error == null ? a : null;
        }
    }
}
