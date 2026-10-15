// 言 · 便携包的启动器（言.exe）：与 start.cmd 做同一件事——用旁边 node\ 里自带的 Node 起本机桥接（server.js --open），
// 没带就用系统装的。自带的 Node 接在 PATH 末尾：模型跑的 node、npx 与环境里 npm 装的工具找得到它，系统已装的仍然优先。
// 窗口即桥接，须开着；桥接退出就停在这里说一声，不一闪而过。由 pack/pack.mjs 用系统自带的 csc 编出（C# 5，不另装 SDK）
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Text;

class Launcher
{
    static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        Console.Title = "言 · 本机桥接 - 请保持开启";
        // Ctrl+C 交给桥接自己收拾，这里等它退了再说话
        Console.CancelKeyPress += delegate (object sender, ConsoleCancelEventArgs e) { e.Cancel = true; };
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string bundled = Path.Combine(root, "node");
        bool own = File.Exists(Path.Combine(bundled, "node.exe"));
        ProcessStartInfo start = new ProcessStartInfo(own ? Path.Combine(bundled, "node.exe") : "node");
        start.Arguments = "server.js --open " + string.Join(" ", args);
        start.WorkingDirectory = root;
        start.UseShellExecute = false;
        if (own)
        {
            string path = Environment.GetEnvironmentVariable("PATH") ?? "";
            start.EnvironmentVariables["PATH"] = path.TrimEnd(';') + ";" + bundled;
        }
        int code;
        try
        {
            Process bridge = Process.Start(start);
            bridge.WaitForExit();
            code = bridge.ExitCode;
        }
        catch (Win32Exception)
        {
            Console.WriteLine("未找到 node：包里的 node 文件夹不见了，系统也没装 Node.js。请重新解压言的便携包，或装 Node.js 18 以上（https://nodejs.org）。");
            Pause();
            return 1;
        }
        Console.WriteLine();
        Console.WriteLine("桥接已退出（退出码 " + code + "）。若不是你按 Ctrl+C 关的，上面的输出就是原因；页面此时已连不上桥接。");
        Pause();
        return code;
    }

    static void Pause()
    {
        Console.WriteLine("按任意键关闭窗口……");
        try { Console.ReadKey(true); } catch (InvalidOperationException) { }
    }
}
