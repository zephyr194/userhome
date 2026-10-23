export type CaddyExampleSupport = "rules" | "reference";

export interface CaddyExample {
  id: string;
  title: string;
  purpose: string;
  /** "rules": the site rules form can express it as written. "reference": use it only in the raw editor. */
  support: CaddyExampleSupport;
  text: string;
}

export const REFERENCE_NOTICE = "仅作参考，需在原始编辑中使用。";

export const CADDY_EXAMPLES: readonly CaddyExample[] = [
  {
    id: "reverse-proxy",
    title: "本地反向代理",
    purpose: "把 127.0.0.1:8080 的请求转发到本机 3000 端口的应用，可直接填入站点规则。",
    support: "rules",
    text: ["http://127.0.0.1:8080 {", "\treverse_proxy http://localhost:3000", "}", ""].join("\n"),
  },
  {
    id: "file-server",
    title: "静态文件服务",
    purpose: "直接提供一个目录里的网页与文件，适合预览构建产物。",
    support: "reference",
    text: ["http://127.0.0.1:8081 {", "\troot * /path/to/site", "\tfile_server", "}", ""].join("\n"),
  },
  {
    id: "multi-site",
    title: "多站点分域名",
    purpose: "同一台机器按域名区分两个站点，各自转发到不同的应用。",
    support: "reference",
    text: [
      "http://app.example.test {",
      "\treverse_proxy localhost:3000",
      "}",
      "",
      "http://api.example.test {",
      "\treverse_proxy localhost:3001",
      "}",
      "",
    ].join("\n"),
  },
  {
    id: "handle-path",
    title: "路径前缀转发",
    purpose: "只把 /api/ 开头的请求转发给应用，其余路径交给静态文件。",
    support: "reference",
    text: [
      "http://127.0.0.1:8080 {",
      "\thandle_path /api/* {",
      "\t\treverse_proxy localhost:3000",
      "\t}",
      "\thandle {",
      "\t\troot * /path/to/site",
      "\t\tfile_server",
      "\t}",
      "}",
      "",
    ].join("\n"),
  },
  {
    id: "tls-internal",
    title: "HTTPS 本地证书",
    purpose: "用 Caddy 生成的本地证书提供 HTTPS，本应用不会安装或信任这份证书。",
    support: "reference",
    text: ["https://localhost:8443 {", "\ttls internal", "\treverse_proxy localhost:3000", "}", ""].join("\n"),
  },
  {
    id: "redirect",
    title: "重定向",
    purpose: "把旧地址永久跳转到新地址，让旧链接仍然可用。",
    support: "reference",
    text: ["http://127.0.0.1:8080 {", "\tredir /old-page /new-page 301", "}", ""].join("\n"),
  },
  {
    id: "encode",
    title: "压缩响应",
    purpose: "对响应启用 zstd 与 gzip 压缩，减少传输的数据量。",
    support: "reference",
    text: [
      "http://127.0.0.1:8080 {",
      "\tencode zstd gzip",
      "\treverse_proxy localhost:3000",
      "}",
      "",
    ].join("\n"),
  },
  {
    id: "header",
    title: "响应头",
    purpose: "为每个响应添加固定的安全响应头，例如禁止浏览器猜测内容类型。",
    support: "reference",
    text: [
      "http://127.0.0.1:8080 {",
      "\theader X-Content-Type-Options nosniff",
      "\treverse_proxy localhost:3000",
      "}",
      "",
    ].join("\n"),
  },
];
