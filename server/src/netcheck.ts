/**
 * Диагностика сети сервера склада.
 *
 * Типичная проблема: на ПК включён VPN (WireGuard, OpenVPN…), в настройках
 * которого «разрешённые адреса» (AllowedIPs) захватывают локальную сеть
 * 192.168.x.x. Тогда ответы терминалам Wi-Fi уходят в туннель и ПК
 * «не видит» телефоны. Проверяем маршрут до соседнего адреса в каждой
 * локальной подсети: если он идёт не через сетевую карту этой подсети —
 * подсеть перехвачена VPN.
 */
import { execFile } from 'node:child_process';
import { networkInterfaces } from 'node:os';

export interface NetAddress {
  iface: string;
  address: string;
  cidr: string;
  url: string;
  kind: 'lan' | 'vpn';
  /** Интерфейс, через который реально уходит трафик в эту подсеть (если перехвачен). */
  hijackedBy?: string;
}

export interface NetReport {
  addresses: NetAddress[];
  problems: string[];
  checkedAt: string;
}

const VPN_NAME = /wireguard|\bwg\d*\b|tun|tap|vpn|tailscale|zerotier|hamachi|radmin|ppp|openvpn|amnezia|outline/i;

function ipToInt(ip: string) {
  return ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
}

function intToIp(n: number) {
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
}

function prefixLen(mask: string) {
  return mask.split('.').reduce((a, o) => a + Number(o).toString(2).split('').filter((b) => b === '1').length, 0);
}

function run(cmd: string, args: string[], timeout = 6000): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

/** Через какой интерфейс ОС отправит пакет на адрес ip. */
export async function routeInterface(ip: string): Promise<string | null> {
  if (process.platform === 'win32') {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `(Find-NetRoute -RemoteIPAddress ${ip} -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceAlias } | Select-Object -First 1).InterfaceAlias`]);
    return out.trim() || null;
  }
  if (process.platform === 'linux') {
    const m = /\bdev\s+(\S+)/.exec(await run('ip', ['-o', 'route', 'get', ip]));
    return m ? m[1] : null;
  }
  if (process.platform === 'darwin') {
    const m = /interface:\s*(\S+)/.exec(await run('route', ['-n', 'get', ip]));
    return m ? m[1] : null;
  }
  return null;
}

/** Имена VPN-адаптеров Windows по описанию драйвера (имя туннеля WireGuard бывает любым). */
export async function vpnAdapterNames(): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "Get-NetAdapter -IncludeHidden -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceDescription -match 'WireGuard|Wintun|TAP-Windows|OpenVPN|VPN|Tunnel' } | ForEach-Object { $_.Name }"]);
  return out.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
}

export interface NetDeps {
  interfaces: () => ReturnType<typeof networkInterfaces>;
  route: (ip: string) => Promise<string | null>;
  vpnNames?: () => Promise<string[]>;
}

export async function checkNetwork(port: number, deps: NetDeps = { interfaces: networkInterfaces, route: routeInterface, vpnNames: vpnAdapterNames }): Promise<NetReport> {
  const list: { iface: string; address: string; netmask: string }[] = [];
  for (const [iface, addrs] of Object.entries(deps.interfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) list.push({ iface, address: a.address, netmask: a.netmask });
  }
  const vpnIfaces = new Set(list.filter((a) => VPN_NAME.test(a.iface)).map((a) => a.iface));
  for (const n of (await deps.vpnNames?.().catch(() => [])) ?? []) vpnIfaces.add(n);
  const problems: string[] = [];
  const result: NetAddress[] = [];

  for (const a of list) {
    const bits = prefixLen(a.netmask);
    const base = ipToInt(a.address) & (bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0);
    const cidr = `${intToIp(base >>> 0)}/${bits}`;
    const entry: NetAddress = { iface: a.iface, address: a.address, cidr, url: `http://${a.address}:${port}`, kind: 'lan' };
    if (bits <= 30 && !vpnIfaces.has(a.iface)) {
      let probe = (base + 2) >>> 0;
      if (intToIp(probe) === a.address) probe = (base + 3) >>> 0;
      const via = await deps.route(intToIp(probe));
      if (via && via !== a.iface) {
        entry.hijackedBy = via;
        vpnIfaces.add(via);
        problems.push(
          `Локальная сеть ${cidr} (${a.iface}) перехвачена интерфейсом «${via}» — вероятно, VPN. ` +
          `Терминалы по Wi-Fi не смогут подключиться к серверу. Исключите ${cidr} из разрешённых адресов ` +
          `(AllowedIPs) VPN или переведите сеть склада на подсеть 172.16.x.x / 10.x.x.x.`);
      }
    }
    result.push(entry);
  }
  for (const e of result) if (vpnIfaces.has(e.iface)) e.kind = 'vpn';
  result.sort((x, y) => (x.kind === y.kind ? 0 : x.kind === 'lan' ? -1 : 1));
  if (!result.some((e) => e.kind === 'lan')) {
    problems.push('Не найдено ни одной сетевой карты локальной сети (Wi-Fi / Ethernet). Подключите ПК к сети склада.');
  }
  return { addresses: result, problems, checkedAt: new Date().toISOString() };
}
