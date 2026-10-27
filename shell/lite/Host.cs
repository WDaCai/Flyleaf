using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Flyleaf.Lite
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.ThreadException += delegate(object sender, ThreadExceptionEventArgs e)
            {
                Log(e.Exception.ToString());
                MessageBox.Show(e.Exception.Message, "Flyleaf", MessageBoxButtons.OK, MessageBoxIcon.Error);
            };

            bool createdNew;
            using (Mutex mutex = new Mutex(true, @"Local\Flyleaf.Single", out createdNew))
            {
                if (!createdNew)
                {
                    SignalExisting();
                    return;
                }
                Application.Run(new ShellForm());
                GC.KeepAlive(mutex);
            }
        }

        static void SignalExisting()
        {
            try
            {
                EventWaitHandle ev = EventWaitHandle.OpenExisting(@"Local\Flyleaf.Show");
                ev.Set();
                ev.Close();
            }
            catch (Exception ex)
            {
                Log("signal " + ex.Message);
            }
        }

        internal static void Log(string line)
        {
            try
            {
                string dir = ShellForm.DataRoot();
                Directory.CreateDirectory(dir);
                File.AppendAllText(Path.Combine(dir, "lite.log"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ") + line + "\r\n", Encoding.UTF8);
            }
            catch
            {
            }
        }
    }

    sealed class ShellForm : Form
    {
        const int WmHotkey = 0x0312;
        const int WmNclButtonDown = 0xA1;
        const int HtCaption = 2;
        const int HtBottomRight = 17;
        const int ModControl = 0x0002;
        const int ModAlt = 0x0001;
        const int VkSpace = 0x20;
        const int SwRestore = 9;

        readonly WebView2 mainWeb = new WebView2();
        readonly WebView2 cardWeb = new WebView2();
        readonly Form card = new Form();
        readonly Label loading = new Label();
        readonly StringBuilder stderr = new StringBuilder();
        readonly string appDir;

        NotifyIcon tray;
        Process node;
        IntPtr job = IntPtr.Zero;
        EventWaitHandle showEvent;
        RegisteredWaitHandle showWait;
        int port;
        bool quitting;
        bool trayTipShown;
        bool hotkeyOk;
        bool pinned = true;
        int cardX = 80;
        int cardY = 80;
        int cardW = 340;
        int cardH = 200;

        public ShellForm()
        {
            appDir = AppDomain.CurrentDomain.BaseDirectory;
            Text = "Flyleaf";
    try
    {
      Icon embedded = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
      if (embedded != null)
      {
        this.Icon = embedded;
        card.Icon = (Icon)embedded.Clone();
      }
    }
    catch { }
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(1440, 900);
            MinimumSize = new Size(960, 600);
            BackColor = Color.FromArgb(14, 16, 19);

            mainWeb.Dock = DockStyle.Fill;
            loading.Dock = DockStyle.Fill;
            loading.Text = "正在启动…";
            loading.TextAlign = ContentAlignment.MiddleCenter;
            loading.ForeColor = Color.FromArgb(215, 219, 224);
            loading.BackColor = Color.FromArgb(14, 16, 19);
            loading.Font = new Font("Microsoft YaHei UI", 12f);
            Controls.Add(mainWeb);
            Controls.Add(loading);
            loading.BringToFront();

            card.Text = "随记";
            card.FormBorderStyle = FormBorderStyle.None;
            card.ShowInTaskbar = false;
            card.StartPosition = FormStartPosition.Manual;
            card.BackColor = Color.FromArgb(21, 24, 29);
            card.MinimumSize = new Size(260, 160);
            cardWeb.Dock = DockStyle.Fill;
            card.Controls.Add(cardWeb);
            card.FormClosing += CardClosing;
            card.ResizeEnd += delegate { ReadCardBounds(); SaveState(); ApplyCardRegion(); };

            LoadState();
            BuildTray();

            showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\Flyleaf.Show");
            showWait = ThreadPool.RegisterWaitForSingleObject(showEvent, OnShowSignal, null, -1, false);

            FormClosing += MainClosing;
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            hotkeyOk = RegisterHotKey(Handle, 1, ModControl | ModAlt, VkSpace);
            if (tray != null)
            {
                tray.Text = hotkeyOk ? "Flyleaf" : "Flyleaf（热键被占用）";
            }
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            Thread worker = new Thread(StartCore);
            worker.IsBackground = true;
            worker.Name = "yan-core";
            worker.Start();
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WmHotkey && m.WParam.ToInt32() == 1)
            {
                ToggleCard();
                return;
            }
            base.WndProc(ref m);
        }

        void OnShowSignal(object state, bool timedOut)
        {
            try
            {
                BeginInvoke(new Action(ShowMain));
            }
            catch (Exception ex)
            {
                Program.Log(ex.Message);
            }
        }

        void StartCore()
        {
            try
            {
                string nodePath = FindNode();
                if (nodePath == null)
                {
                    throw new InvalidOperationException("找不到 node.exe。把 node.exe 放在 Flyleaf.exe 旁边，或安装 Node.js 并加入 PATH。");
                }
                port = FreePort();
                string server = Path.Combine(appDir, "server.cjs");
                string renderer = Path.Combine(appDir, "renderer");
                if (!File.Exists(server)) throw new FileNotFoundException("缺少 server.cjs", server);
                if (!Directory.Exists(renderer)) throw new DirectoryNotFoundException("缺少 renderer 目录");

                string vault = PreferredVault();
                string failure = LaunchCore(nodePath, server, renderer, vault);
                if (failure != null && IsAccessDenied(failure) && !IsExplicitVault())
                {
                    StopNode();
                    // 未签名程序会被 Windows 降到低完整性级别，写不了「文档」和 LocalAppData，只能写 LocalLow
                    vault = Path.Combine(DataRoot(), "vault");
                    Program.Log("vault fallback " + vault);
                    failure = LaunchCore(nodePath, server, renderer, vault);
                }
                if (failure != null) throw new InvalidOperationException(failure);
                BeginInvoke(new Action(delegate { InitWeb(); }));
            }
            catch (Exception ex)
            {
                Program.Log(ex.ToString());
                BeginInvoke(new Action(delegate { Fail(ex.Message); }));
            }
        }

        async void InitWeb()
        {
            try
            {
                string data = Path.Combine(DataRoot(), "webview");
                Directory.CreateDirectory(data);
                IntPtr ignoredCard = card.Handle;
                card.Opacity = 0;
                card.Show();
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, data);
                await mainWeb.EnsureCoreWebView2Async(env);
                await cardWeb.EnsureCoreWebView2Async(env);
                WireMain();
                WireCard();
                string origin = "http://127.0.0.1:" + port.ToString();
                mainWeb.Source = new Uri(origin + "/");
                cardWeb.Source = new Uri(origin + "/card.html");
                card.Hide();
                card.Opacity = 0.96;
                GC.KeepAlive(ignoredCard);
            }
            catch (Exception ex)
            {
                Program.Log(ex.ToString());
                Fail(ex.Message);
            }
        }

        void WireMain()
        {
            CoreWebView2 core = mainWeb.CoreWebView2;
            core.Settings.AreDefaultScriptDialogsEnabled = true;
            core.DocumentTitleChanged += delegate { Text = "Flyleaf"; ApplyAppIcon(); };
            mainWeb.NavigationCompleted += delegate(object sender, CoreWebView2NavigationCompletedEventArgs e)
            {
                loading.Visible = false;
                if (!e.IsSuccess)
                {
                    loading.Visible = true;
                    loading.Text = "页面加载失败：" + e.WebErrorStatus.ToString();
                }
            };
        }

        void WireCard()
        {
            CoreWebView2 core = cardWeb.CoreWebView2;
            core.Settings.AreDefaultScriptDialogsEnabled = true;
            core.Settings.IsStatusBarEnabled = false;
            core.DocumentTitleChanged += delegate { card.Text = "随记"; ApplyAppIcon(); };
            core.WebMessageReceived += CardMessage;
            core.WindowCloseRequested += delegate { HideCard(); };
            ApplyCardRegion();
        }

        void CardMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string msg;
            try
            {
                msg = e.TryGetWebMessageAsString();
            }
            catch
            {
                return;
            }
            if (msg == "drag")
            {
                ReleaseCapture();
                SendMessage(card.Handle, WmNclButtonDown, (IntPtr)HtCaption, IntPtr.Zero);
            }
            else if (msg == "resize")
            {
                ReleaseCapture();
                SendMessage(card.Handle, WmNclButtonDown, (IntPtr)HtBottomRight, IntPtr.Zero);
            }
        }

        void BuildTray()
        {
            tray = new NotifyIcon();
            Icon appIcon = null;
      try { appIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
      tray.Icon = appIcon ?? (Icon)SystemIcons.Application.Clone();
            tray.Text = "Flyleaf";
            tray.Visible = true;
            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("打开主窗口", null, delegate { ShowMain(); });
            menu.Items.Add("随记", null, delegate { ToggleCard(); });
            ToolStripMenuItem pin = new ToolStripMenuItem("置顶随记");
            pin.Checked = pinned;
            pin.Click += delegate
            {
                pinned = !pinned;
                pin.Checked = pinned;
                card.TopMost = pinned;
                SaveState();
            };
            menu.Items.Add(pin);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出", null, delegate { Quit(); });
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += delegate { ToggleCard(); };
        }

        void ShowMain()
        {
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Show();
            Activate();
        }

        void ShowCard()
        {
            ClampCard();
            card.Bounds = new Rectangle(cardX, cardY, Math.Max(260, cardW), Math.Max(160, cardH));
            card.TopMost = pinned;
            ApplyCardRegion();
            card.Show();
            card.Activate();
            try
            {
                cardWeb.Focus();
            }
            catch
            {
            }
        }

        void HideCard()
        {
            if (card.Visible) ReadCardBounds();
            SaveState();
            card.Hide();
        }

        void ToggleCard()
        {
            if (card.Visible) HideCard();
            else ShowCard();
        }

        void ReadCardBounds()
        {
            if (card.WindowState != FormWindowState.Normal) return;
            cardX = card.Left;
            cardY = card.Top;
            cardW = card.Width;
            cardH = card.Height;
        }

        void ClampCard()
        {
            Screen screen = Screen.FromPoint(new Point(cardX, cardY));
            Rectangle area = screen.WorkingArea;
            cardW = Math.Max(260, Math.Min(cardW, area.Width));
            cardH = Math.Max(160, Math.Min(cardH, area.Height));
            if (cardX < area.Left) cardX = area.Left;
            if (cardY < area.Top) cardY = area.Top;
            if (cardX + cardW > area.Right) cardX = area.Right - cardW;
            if (cardY + cardH > area.Bottom) cardY = area.Bottom - cardH;
        }

        void ApplyCardRegion()
        {
            if (!card.IsHandleCreated) return;
            IntPtr region = CreateRoundRectRgn(0, 0, card.Width, card.Height, 24, 24);
            card.Region = Region.FromHrgn(region);
        }

        
  void ApplyAppIcon()
  {
    try
    {
      Icon embedded = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
      if (embedded == null) return;
      this.Icon = embedded;
      if (card != null) card.Icon = (Icon)embedded.Clone();
      if (tray != null) tray.Icon = (Icon)embedded.Clone();
    }
    catch { }
  }
  void MainClosing(object sender, FormClosingEventArgs e)
        {
            if (!quitting && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
                if (!trayTipShown && tray != null)
                {
                    trayTipShown = true;
                    tray.BalloonTipTitle = "Flyleaf";
                    tray.BalloonTipText = "主窗口已收进托盘，不会退出。要退出请右键托盘图标选择「退出」。";
                    tray.ShowBalloonTip(4500);
                }
            }
        }

        void CardClosing(object sender, FormClosingEventArgs e)
        {
            if (!quitting)
            {
                e.Cancel = true;
                HideCard();
            }
        }

        void Fail(string message)
        {
            loading.Visible = true;
            loading.Text = message;
            MessageBox.Show(this, message, "Flyleaf", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Quit();
        }

        void Quit()
        {
            if (quitting) return;
            quitting = true;
            try
            {
                UnregisterHotKey(Handle, 1);
            }
            catch
            {
            }
            try
            {
                if (showWait != null) showWait.Unregister(null);
            }
            catch
            {
            }
            try
            {
                if (showEvent != null) showEvent.Close();
            }
            catch
            {
            }
            try
            {
                if (tray != null)
                {
                    tray.Visible = false;
                    tray.Dispose();
                }
            }
            catch
            {
            }
            try
            {
                if (node != null && !node.HasExited) node.Kill();
            }
            catch
            {
            }
            try
            {
                if (job != IntPtr.Zero) CloseHandle(job);
            }
            catch
            {
            }
            Application.Exit();
        }

        internal static string DataRoot()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "AppData", "LocalLow", "Flyleaf");
        }

        string PreferredVault()
        {
            string vault = Environment.GetEnvironmentVariable("FLYLEAF_VAULT");
            if (string.IsNullOrEmpty(vault)) vault = Environment.GetEnvironmentVariable("YAN_VAULT");
            if (string.IsNullOrEmpty(vault)) vault = ReadBesideVaultPath();
            if (string.IsNullOrEmpty(vault))
            {
                vault = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "flyleaf-vault");
            }
            return vault;
        }

        string ReadBesideVaultPath()
        {
            try
            {
                string file = Path.Combine(appDir, "vault.path");
                if (!File.Exists(file)) return null;
                string line = File.ReadAllText(file).Trim();
                if (string.IsNullOrEmpty(line)) return null;
                // 允许相对 exe 目录的相对路径
                if (!Path.IsPathRooted(line)) line = Path.GetFullPath(Path.Combine(appDir, line));
                return line;
            }
            catch
            {
                return null;
            }
        }

        bool IsExplicitVault()
        {
            if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("FLYLEAF_VAULT"))) return true;
            if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("YAN_VAULT"))) return true;
            return !string.IsNullOrEmpty(ReadBesideVaultPath());
        }

        static bool IsAccessDenied(string text)
        {
            if (string.IsNullOrEmpty(text)) return false;
            return text.IndexOf("EPERM") >= 0 || text.IndexOf("EACCES") >= 0 || text.IndexOf("operation not permitted") >= 0;
        }

        void StopNode()
        {
            try
            {
                if (node != null && !node.HasExited) node.Kill();
            }
            catch
            {
            }
            node = null;
            lock (stderr)
            {
                stderr.Length = 0;
            }
        }

        string LaunchCore(string nodePath, string server, string renderer, string vault)
        {
            StopNode();
            port = FreePort();
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = nodePath;
            psi.Arguments = Quote(server) + " --vault " + Quote(vault) + " --port " + port.ToString() + " --static " + Quote(renderer);
            psi.WorkingDirectory = appDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            node = new Process();
            node.StartInfo = psi;
            node.OutputDataReceived += delegate(object sender, DataReceivedEventArgs ev)
            {
                if (!string.IsNullOrEmpty(ev.Data)) Program.Log(ev.Data);
            };
            node.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs ev)
            {
                if (string.IsNullOrEmpty(ev.Data)) return;
                lock (stderr)
                {
                    if (stderr.Length < 4000) stderr.AppendLine(ev.Data);
                }
                Program.Log(ev.Data);
            };
            if (!node.Start()) return "无法启动 node";
            AssignJob(node);
            node.BeginOutputReadLine();
            node.BeginErrorReadLine();
            if (WaitHealth(port, 20000)) return null;
            if (node != null && node.HasExited)
            {
                try { node.WaitForExit(2000); }
                catch { }
            }
            string detail;
            lock (stderr) detail = stderr.ToString();
            bool exited = node != null && node.HasExited;
            StopNode();
            return ShortFailure(detail, exited);
        }

        static string ShortFailure(string detail, bool exited)
        {
            string line = "";
            if (!string.IsNullOrEmpty(detail))
            {
                string[] lines = detail.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                for (int i = 0; i < lines.Length; i++)
                {
                    if (lines[i].IndexOf("Error:") >= 0)
                    {
                        line = lines[i].Trim();
                        break;
                    }
                }
                if (line.Length == 0 && lines.Length > 0) line = lines[0].Trim();
            }
            if (line.Length > 280) line = line.Substring(0, 280);
            if (line.Length == 0) return exited ? "笔记目录无法打开。" : "核心没有在 20 秒内就绪。";
            return (exited ? "笔记目录无法打开。\r\n" : "核心没有在 20 秒内就绪。\r\n") + line;
        }

        string FindNode()
        {
            string beside = Path.Combine(appDir, "node.exe");
            if (File.Exists(beside)) return beside;
            string pathEnv = Environment.GetEnvironmentVariable("PATH");
            if (string.IsNullOrEmpty(pathEnv)) return null;
            string[] dirs = pathEnv.Split(';');
            for (int i = 0; i < dirs.Length; i++)
            {
                string dir = dirs[i].Trim();
                if (dir.Length == 0) continue;
                try
                {
                    string candidate = Path.Combine(dir, "node.exe");
                    if (File.Exists(candidate)) return candidate;
                }
                catch
                {
                }
            }
            return null;
        }

        static int FreePort()
        {
            for (int p = 47321; p < 47340; p++)
            {
                if (!PortBusy(p)) return p;
            }
            return 47321;
        }

        static bool PortBusy(int candidate)
        {
            TcpListener listener = null;
            try
            {
                listener = new TcpListener(IPAddress.Loopback, candidate);
                listener.Start();
                return false;
            }
            catch
            {
                return true;
            }
            finally
            {
                if (listener != null) listener.Stop();
            }
        }

        bool WaitHealth(int candidate, int timeoutMs)
        {
            int waited = 0;
            while (waited < timeoutMs)
            {
                if (node != null && node.HasExited) return false;
                if (Probe(candidate)) return true;
                Thread.Sleep(200);
                waited += 200;
            }
            return false;
        }

        static bool Probe(int candidate)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + candidate.ToString() + "/api/v1/health");
                req.Method = "GET";
                req.Timeout = 400;
                req.Proxy = null;
                using (WebResponse res = req.GetResponse())
                {
                    HttpWebResponse http = (HttpWebResponse)res;
                    return http.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        void AssignJob(Process process)
        {
            try
            {
                job = CreateJobObject(IntPtr.Zero, null);
                if (job == IntPtr.Zero) return;
                JobObjectExtended info = new JobObjectExtended();
                info.Basic.LimitFlags = 0x2000;
                int size = Marshal.SizeOf(typeof(JobObjectExtended));
                if (!SetInformationJobObject(job, 9, ref info, (uint)size)) return;
                AssignProcessToJobObject(job, process.Handle);
            }
            catch (Exception ex)
            {
                Program.Log("job " + ex.Message);
            }
        }

        void LoadState()
        {
            try
            {
                string file = StatePath();
                if (!File.Exists(file)) return;
                string[] parts = File.ReadAllText(file, Encoding.UTF8).Split(',');
                if (parts.Length < 5) return;
                cardX = int.Parse(parts[0].Trim());
                cardY = int.Parse(parts[1].Trim());
                cardW = int.Parse(parts[2].Trim());
                cardH = int.Parse(parts[3].Trim());
                pinned = parts[4].Trim() == "1";
            }
            catch (Exception ex)
            {
                Program.Log("state " + ex.Message);
            }
        }

        void SaveState()
        {
            try
            {
                string file = StatePath();
                Directory.CreateDirectory(Path.GetDirectoryName(file));
                string text = cardX.ToString() + "," + cardY.ToString() + "," + cardW.ToString() + "," + cardH.ToString() + "," + (pinned ? "1" : "0");
                File.WriteAllText(file, text, Encoding.UTF8);
            }
            catch (Exception ex)
            {
                Program.Log("save " + ex.Message);
            }
        }

        static string StatePath()
        {
            return Path.Combine(DataRoot(), "shell.txt");
        }

        static string Quote(string value)
        {
            return "\"" + value.Replace("\"", "\\\"") + "\"";
        }

        [DllImport("user32.dll")]
        static extern bool RegisterHotKey(IntPtr hWnd, int id, int fsModifiers, int vk);

        [DllImport("user32.dll")]
        static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        [DllImport("user32.dll")]
        static extern bool ReleaseCapture();

        [DllImport("user32.dll")]
        static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

        [DllImport("gdi32.dll")]
        static extern IntPtr CreateRoundRectRgn(int left, int top, int right, int bottom, int widthEllipse, int heightEllipse);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool SetInformationJobObject(IntPtr hJob, int jobObjectInfoClass, ref JobObjectExtended info, uint cb);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool CloseHandle(IntPtr hObject);

        [StructLayout(LayoutKind.Sequential)]
        struct JobObjectBasic
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct IoCounters
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct JobObjectExtended
        {
            public JobObjectBasic Basic;
            public IoCounters Io;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }
    }
}
