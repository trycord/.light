// .light — default starter files for every approved runtime.
// A newly provisioned service must boot successfully out of the box. Files are
// written to the instance's persistent /app volume before the container starts.

const PORT = `Number(process.env.LIGHT_PORT || process.env.PORT || 3000)`;

const nodeApp = `const http = require('http');\nconst port = ${PORT};\nhttp.createServer((req, res) => {\n  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});\n  res.end('<!doctype html><title>.light</title><h1>Hello from .light</h1><p>Node.js service is running.</p>');\n}).listen(port, '0.0.0.0', () => console.log('.light service listening on ' + port));\n`;

const bunApp = `const port = ${PORT};\nBun.serve({ port, fetch() { return new Response('<!doctype html><h1>Hello from .light</h1><p>Bun service is running.</p>', { headers: { 'Content-Type': 'text/html' } }); } });\nconsole.log('.light service listening on ' + port);\n`;

const denoApp = `const port = ${PORT};\nDeno.serve({ port }, () => new Response('<!doctype html><h1>Hello from .light</h1><p>Deno service is running.</p>', { headers: { 'Content-Type': 'text/html' } }));\nconsole.log('.light service listening on ' + port);\n`;

const pythonApp = `from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer\nimport os\nport = int(os.environ.get('LIGHT_PORT', os.environ.get('PORT', 8000)))\nclass H(BaseHTTPRequestHandler):\n    def do_GET(self):\n        body = b'<!doctype html><h1>Hello from .light</h1><p>Python service is running.</p>'\n        self.send_response(200)\n        self.send_header('Content-Type', 'text/html; charset=utf-8')\n        self.send_header('Content-Length', str(len(body)))\n        self.end_headers()\n        self.wfile.write(body)\nThreadingHTTPServer(('0.0.0.0', port), H).serve_forever()\n`;

const javaApp = `import com.sun.net.httpserver.*;\nimport java.net.InetSocketAddress;\nimport java.nio.charset.StandardCharsets;\npublic class Main {\n  public static void main(String[] args) throws Exception {\n    int port = Integer.parseInt(System.getenv().getOrDefault("LIGHT_PORT", System.getenv().getOrDefault("PORT", "8080")));\n    HttpServer s = HttpServer.create(new InetSocketAddress("0.0.0.0", port), 0);\n    s.createContext("/", ex -> { byte[] b = "<!doctype html><h1>Hello from .light</h1><p>Java service is running.</p>".getBytes(StandardCharsets.UTF_8); ex.sendResponseHeaders(200, b.length); ex.getResponseBody().write(b); ex.close(); });\n    s.start();\n    System.out.println(".light service listening on " + port);\n  }\n}\n`;

const goMod = `module lightapp\n\ngo 1.23\n`;
const goApp = `package main\nimport ("fmt"; "net/http"; "os")\nfunc main() {\n  port := os.Getenv("LIGHT_PORT"); if port == "" { port = os.Getenv("PORT") }; if port == "" { port = "8080" }\n  http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "<!doctype html><h1>Hello from .light</h1><p>Go service is running.</p>") })\n  fmt.Println(".light service listening on", port)\n  http.ListenAndServe("0.0.0.0:"+port, nil)\n}\n`;

const rustToml = `[package]\nname = "lightapp"\nversion = "0.1.0"\nedition = "2021"\n`;
const rustApp = `use std::io::{Read, Write};\nuse std::net::TcpListener;\nfn main() {\n    let port = std::env::var("LIGHT_PORT").or_else(|_| std::env::var("PORT")).unwrap_or_else(|_| "8080".into());\n    let listener = TcpListener::bind(format!("0.0.0.0:{}", port)).unwrap();\n    println!(".light service listening on {}", port);\n    for stream in listener.incoming() {\n        let mut s = stream.unwrap();\n        let mut buf = [0u8; 1024]; let _ = s.read(&mut buf);\n        let body = b"<!doctype html><h1>Hello from .light</h1><p>Rust service is running.</p>";\n        let _ = s.write_all(b"HTTP/1.1 200 OK\\r\\nContent-Type: text/html\\r\\nContent-Length: ").and_then(|_| s.write_all(body.len().to_string().as_bytes())).and_then(|_| s.write_all(b"\\r\\n\\r\\n")).and_then(|_| s.write_all(body));\n    }\n}\n`;

const phpApp = `<?php\nheader('Content-Type: text/html; charset=utf-8');\necho '<!doctype html><h1>Hello from .light</h1><p>PHP service is running.</p>';\n`;

const rubyApp = `require 'socket'\nport = Integer(ENV['LIGHT_PORT'] || ENV['PORT'] || 8080)\nserver = TCPServer.new('0.0.0.0', port)\nputs ".light service listening on #{port}"\nloop do\n  client = server.accept\n  body = '<!doctype html><h1>Hello from .light</h1><p>Ruby service is running.</p>'\n  client.write("HTTP/1.1 200 OK\\r\\nContent-Type: text/html\\r\\nContent-Length: #{body.bytesize}\\r\\n\\r\\n#{body}")\n  client.close\nend\n`;

const cppApp = `#include <cstdio>\n#include <cstdlib>\n#include <cstring>\n#ifdef _WIN32\n#include <winsock2.h>\n#else\n#include <sys/socket.h>\n#include <netinet/in.h>\n#include <unistd.h>\n#endif\nint main(){\n  int port = std::getenv("LIGHT_PORT") ? std::atoi(std::getenv("LIGHT_PORT")) : (std::getenv("PORT") ? std::atoi(std::getenv("PORT")) : 8080);\n  printf(".light service scaffold ready on %d\\n", port);\n  while(true){ sleep(60); }\n}\n`;

const dotnetApp = `var builder = WebApplication.CreateBuilder(args);\nvar app = builder.Build();\napp.MapGet("/", () => Results.Content("<!doctype html><h1>Hello from .light</h1><p>.NET service is running.</p>", "text/html"));\napp.Run("http://0.0.0.0:" + (Environment.GetEnvironmentVariable("LIGHT_PORT") ?? Environment.GetEnvironmentVariable("PORT") ?? "8080"));\n`;
const dotnetCsproj = `<Project Sdk="Microsoft.NET.Sdk.Web">\n  <PropertyGroup><TargetFramework>net8.0</TargetFramework><Nullable>enable</Nullable><ImplicitUsings>enable</ImplicitUsings></PropertyGroup>\n</Project>\n`;

const swiftApp = `import Foundation\nlet port = ProcessInfo.processInfo.environment["LIGHT_PORT"] ?? ProcessInfo.processInfo.environment["PORT"] ?? "8080"\nprint(".light service listening on \\(port)")\nRunLoop.current.run()\n`;
const luaApp = `local port = os.getenv("LIGHT_PORT") or os.getenv("PORT") or "8080"\nprint(".light service scaffold ready on "..port)\nwhile true do os.execute("sleep 60") end\n`;
const perlApp = `use strict; use warnings;\nmy $port = $ENV{LIGHT_PORT} || $ENV{PORT} || 8080;\nprint ".light service scaffold ready on $port\\n";\nsleep 60 while 1;\n`;
const elixirApp = `port = String.to_integer(System.get_env("LIGHT_PORT") || System.get_env("PORT") || "4000")\nIO.puts(".light service scaffold ready on #{port}")\nProcess.sleep(:infinity)\n`;
const erlangApp = `-module(main).\n-export([start/0]).\nstart() -> io:format(".light service scaffold ready~n"), timer:sleep(infinity).\n`;
const zigApp = `const std = @import("std");\npub fn main() !void { std.debug.print(".light service scaffold ready\\n", .{}); while (true) std.time.sleep(60 * std.time.ns_per_s); }\n`;
const staticHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>.light</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#12140f;color:#f3ede4}h1{color:#ff4d24}</style></head><body><div><h1>Hello from .light</h1><p>Your static site is live. Upload files with the file manager.</p></div></body></html>\n`;

export const DEFAULT_ENV = {
  postgres: { POSTGRES_PASSWORD: 'light', POSTGRES_DB: 'light' },
  mariadb: { MARIADB_ROOT_PASSWORD: 'light', MARIADB_DATABASE: 'light' },
  mongodb: {},
  redis: {},
  valkey: {},
};

/** Return { files: {relativePath: content}, command, workdir } for a runtime. */
export function scaffold(environmentId) {
  const pkg = (start) => JSON.stringify({ name: 'light-service', version: '1.0.0', private: true, scripts: { start } }, null, 2) + '\n';
  const table = {
    node: { files: { 'package.json': pkg('node index.js'), 'index.js': nodeApp }, command: 'npm start' },
    bun: { files: { 'package.json': pkg('bun run index.ts'), 'index.ts': bunApp }, command: 'bun run start' },
    deno: { files: { 'main.ts': denoApp }, command: 'deno run --allow-net --allow-env main.ts' },
    python: { files: { 'main.py': pythonApp }, command: 'python main.py' },
    java: { files: { 'Main.java': javaApp }, command: 'javac Main.java && java Main' },
    dotnet: { files: { 'lightapp.csproj': dotnetCsproj, 'Program.cs': dotnetApp }, command: 'dotnet run' },
    go: { files: { 'go.mod': goMod, 'main.go': goApp }, command: 'go run .' },
    rust: { files: { 'Cargo.toml': rustToml, 'src/main.rs': rustApp }, command: 'cargo run --release' },
    php: { files: { 'index.php': phpApp }, command: 'php -S 0.0.0.0:${LIGHT_PORT:-8080} -t .', workdir: '/app' },
    ruby: { files: { 'app.rb': rubyApp }, command: 'ruby app.rb' },
    cpp: { files: { 'main.cpp': cppApp }, command: 'g++ -O2 main.cpp -o application && ./application' },
    zig: { files: { 'build.zig': 'const std=@import("std"); pub fn build(b:*std.Build) void { _=b; }\n', 'src/main.zig': zigApp }, command: 'zig run src/main.zig' },
    lua: { files: { 'main.lua': luaApp }, command: 'lua main.lua' },
    perl: { files: { 'app.pl': perlApp }, command: 'perl app.pl' },
    elixir: { files: { 'main.exs': elixirApp }, command: 'elixir main.exs' },
    erlang: { files: { 'main.erl': erlangApp }, command: 'erl -noshell -pa . -s main start' },
    swift: { files: { 'main.swift': swiftApp }, command: 'swift main.swift' },
    'static-site': { files: { 'index.html': staticHtml }, command: '', workdir: '/usr/share/nginx/html' },
    // Discord bot scaffold declares discord.js in the manifest so Shade's
    // dependency installer can install it automatically before startup.
    'discord-bot': {
      files: {
        'package.json': JSON.stringify({ name: 'light-discord-bot', version: '1.0.0', private: true,
          scripts: { start: 'node index.js' }, dependencies: { 'discord.js': '^14.16.3', dotenv: '^16.4.7' } }, null, 2) + '\n',
        'index.js': "const { Client, GatewayIntentBits } = require('discord.js');\nconst client = new Client({ intents: [GatewayIntentBits.Guilds] });\nclient.once('ready', () => console.log('Bot online as', client.user?.tag));\nclient.login(process.env.DISCORD_TOKEN || process.env.BOT_TOKEN || '').catch(e => console.error('Set DISCORD_TOKEN:', e.message));\n",
      },
      command: 'npm start',
    },
    // The Trycord app is baked into its custom image; no scaffold files or
    // alternate workdir bind are needed (the customer workspace holds data only).
    trycord: { files: {}, command: '' },
  };
  return table[environmentId] || { files: {}, command: '', workdir: '/app' };
}
