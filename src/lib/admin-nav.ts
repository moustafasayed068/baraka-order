import type { Role } from "./auth";

// Which admin sections each role sees (pages enforce the same list with requireStaff).
export const NAV = [
  { key: "dashboard", href: "/admin", roles: ["owner", "manager"] },
  { key: "orders", href: "/admin/orders", roles: ["owner", "manager", "cashier"] },
  { key: "callcentre", href: "/admin/call", roles: ["owner", "manager", "cashier", "callcentre"] },
  { key: "menu", href: "/admin/menu", roles: ["owner"] },
  { key: "branches", href: "/admin/branches", roles: ["owner", "manager"] },
  { key: "riders", href: "/admin/riders", roles: ["owner", "manager"] },
  { key: "qr", href: "/admin/qr", roles: ["owner", "manager"] },
  { key: "staff", href: "/admin/staff", roles: ["owner"] },
] as const satisfies readonly { key: string; href: string; roles: readonly Role[] }[];

export const rolesFor = (key: (typeof NAV)[number]["key"]): Role[] => [...NAV.find((n) => n.key === key)!.roles];
