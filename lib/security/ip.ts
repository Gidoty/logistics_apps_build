import { BlockList, isIP } from "node:net";

/**
 * Addresses a server must never connect to on a visitor's behalf: private,
 * loopback, link-local (which includes cloud metadata at 169.254.169.254),
 * shared and reserved ranges, for IPv4 and IPv6.
 *
 * IPv4-mapped IPv6 forms such as ::ffff:127.0.0.1 are caught by the IPv4
 * rules (Node applies IPv4 rules to them). Do not add ::ffff:0:0/96 itself:
 * Node would then match every IPv4 address.
 */
const blocked = new BlockList();

const IPV4_RANGES: [string, number][] = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes broadcast
];

const IPV6_RANGES: [string, number][] = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64: wraps IPv4 addresses
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
];

for (const [network, prefix] of IPV4_RANGES) blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of IPV6_RANGES) blocked.addSubnet(network, prefix, "ipv6");

/** True when the address must not be connected to. Anything that is not an IP address is blocked too. */
export function isBlockedAddress(address: string): boolean {
  const withoutZone = address
    .trim()
    .replace(/^\[|\]$/g, "")
    .replace(/%.*$/, "");
  const family = isIP(withoutZone);
  if (family === 0) return true;
  return blocked.check(withoutZone, family === 4 ? "ipv4" : "ipv6");
}

/** True when the text is an IP address (any form Node understands). */
export function isIpLiteral(host: string): boolean {
  return (
    isIP(
      host
        .trim()
        .replace(/^\[|\]$/g, "")
        .replace(/%.*$/, ""),
    ) !== 0
  );
}
