using System;
using System.Collections.Generic;
using System.CommandLine;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Windows.Networking.Connectivity;
using Windows.Networking.NetworkOperators;

namespace HotshareHelper;

class Program
{
    // The .NET 8 C#/WinRT projection does not expose
    // GetFromCurrentAccessPointConfiguration(), so build the manager from the
    // device's current internet connection profile instead.
    static NetworkOperatorTetheringManager TetheringManager()
    {
        var profile = NetworkInformation.GetInternetConnectionProfile();
        if (profile == null)
        {
            throw new Exception("No active internet connection to share — connect to the internet first");
        }
        return NetworkOperatorTetheringManager.CreateFromConnectionProfile(profile);
    }

    static async Task<int> Main(string[] args)
    {
        var rootCommand = new RootCommand("hotshare hotspot helper");

        var startCommand = new Command("start", "Start the mobile hotspot");
        startCommand.SetHandler(async () =>
        {
            try
            {
                var manager = TetheringManager();
                var config = manager.GetCurrentAccessPointConfiguration();
                config.Band = TetheringWiFiBand.Auto;

                // Try to start tethered hotspot
                var result = await manager.StartTetheringAsync();
                Console.WriteLine($"{{\"status\":\"{result.Status}\",\"clientsAllowed\":{manager.MaxClientCount}}}");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"{{\"error\":\"{ex.Message}\"}}");
                Environment.Exit(1);
            }
        });

        var stopCommand = new Command("stop", "Stop the mobile hotspot");
        stopCommand.SetHandler(async () =>
        {
            try
            {
                var manager = TetheringManager();
                await manager.StopTetheringAsync();
                Console.WriteLine($"{{\"status\":\"stopped\"}}");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"{{\"error\":\"{ex.Message}\"}}");
            }
        });

        var clientsCommand = new Command("clients", "List connected clients");
        clientsCommand.SetHandler(() =>
        {
            try
            {
                var manager = TetheringManager();
                var clients = new List<object>();

                foreach (var client in manager.GetTetheringClients())
                {
                    clients.Add(new
                    {
                        mac = client.MacAddress,
                        ip = "unknown",
                        hostname = client.HostNames?.Select(h => h.DisplayName).FirstOrDefault() ?? "unknown"
                    });
                }

                Console.WriteLine(JsonSerializer.Serialize(clients));
            }
            catch (Exception ex)
            {
                Console.WriteLine("[]");
            }
        });

        var wireguardInstallCommand = new Command("wireguard-install", "Silently install the bundled WireGuard MSI, if not already installed");
        var msiPathOption = new Option<string>("--msi", "Path to the bundled WireGuard MSI");
        wireguardInstallCommand.AddOption(msiPathOption);
        wireguardInstallCommand.SetHandler(async (string msiPath) =>
        {
            try
            {
                var wgExe = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "WireGuard", "wireguard.exe");
                if (File.Exists(wgExe))
                {
                    Console.WriteLine($"{{\"status\":\"already-installed\",\"exe\":\"{wgExe}\"}}");
                    return;
                }
                if (string.IsNullOrEmpty(msiPath) || !File.Exists(msiPath))
                {
                    Console.Error.WriteLine($"{{\"error\":\"MSI not found: {msiPath}\"}}");
                    Environment.Exit(1);
                }
                var psi = new ProcessStartInfo
                {
                    FileName = "msiexec.exe",
                    Arguments = $"/i \"{msiPath}\" /qn /norestart",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                using var process = Process.Start(psi)!;
                await process.WaitForExitAsync();
                if (process.ExitCode is not (0 or 3010))
                {
                    Console.Error.WriteLine($"{{\"error\":\"msiexec failed: {process.ExitCode}\"}}");
                    Environment.Exit(1);
                }
                Console.WriteLine(File.Exists(wgExe)
                    ? $"{{\"status\":\"installed\",\"exe\":\"{wgExe}\"}}"
                    : $"{{\"status\":\"exit-{process.ExitCode}\",\"exe\":null}}");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"{{\"error\":\"{ex.Message}\"}}");
                Environment.Exit(1);
            }
        }, msiPathOption);

        var wireguardStatusCommand = new Command("wireguard-status", "Report whether the WireGuard tunnel service is present/running");
        wireguardStatusCommand.SetHandler(() =>
        {
            try
            {
                var wgExe = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "WireGuard", "wireguard.exe");
                var serviceName = "WireGuardTunnel$hotshare";
                var running = false;
                var installed = false;
                using var sc = new System.Diagnostics.Process();
                sc.StartInfo = new ProcessStartInfo
                {
                    FileName = "sc.exe",
                    Arguments = $"query \"{serviceName}\"",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                };
                sc.Start();
                var output = sc.StandardOutput.ReadToEnd();
                sc.WaitForExit();
                installed = output.Contains(serviceName) || output.Trim().StartsWith("SERVICE_NAME");
                running = output.Contains("RUNNING");
                Console.WriteLine($"{{\"installed\":{installed.ToString().ToLower()},\"running\":{running.ToString().ToLower()},\"exe\":{(File.Exists(wgExe) ? "\"" + wgExe + "\"" : "null")}}}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"{{\"installed\":false,\"running\":false,\"exe\":null,\"error\":\"{ex.Message}\"}}");
            }
        });

        rootCommand.AddCommand(startCommand);
        rootCommand.AddCommand(stopCommand);
        rootCommand.AddCommand(clientsCommand);
        rootCommand.AddCommand(wireguardInstallCommand);
        rootCommand.AddCommand(wireguardStatusCommand);

        return await rootCommand.InvokeAsync(args);
    }
}
