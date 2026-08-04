const CLIENT_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const SERVER_API_URL = process.env.API_URL || CLIENT_API_URL;

export function getApiBase() {
  // Durante SSR (dentro del contenedor web) hay que alcanzar la API por el
  // nombre del servicio Docker (http://api:4000). En el navegador se usa
  // NEXT_PUBLIC_API_URL, que apunta al puerto expuesto en el host.
  const base = typeof window === "undefined" ? SERVER_API_URL : CLIENT_API_URL;
  return base.replace(/\/$/, "");
}

export function assetUrl(path) {
  // Las URLs de imagen viajan dentro del HTML que recibe el navegador, por lo
  // que siempre deben apuntar a la URL visible desde el host (NEXT_PUBLIC_API_URL),
  // nunca al nombre interno del contenedor (API_URL).
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${CLIENT_API_URL.replace(/\/$/, "")}${path}`;
}

export async function fetchJson(path, options = {}) {
  const headers = {
    ...(options.headers || {}),
  };
  // Solo declaramos JSON cuando hay body: Fastify rechaza con 400
  // (FST_ERR_CTP_EMPTY_JSON_BODY) si llega Content-Type json sin contenido,
  // como pasa con los PATCH de Entregar/Cancelar o el import de Excel.
  if (options.body != null) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Error en la solicitud");
  }
  return data;
}

export function formatMoney(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

export const MAX_QTY = 50;

export function invoiceUrl(orderId) {
  return `${getApiBase()}/api/orders/${orderId}/invoice`;
}

export function buildWhatsAppUrl(order, customerName) {
  const number = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "5491126151141";
  const lines = [
    `*Pedido SMG Joyería*`,
    `Cliente: ${customerName}`,
    `Pedido #${order.id}`,
    "",
    ...order.items.map(
      (item) =>
        `• ${item.reference} x${item.quantity} — ${formatMoney(item.lineTotal)}`
    ),
    "",
  ];

  if (order.discountAmount > 0) {
    lines.push(`Subtotal: ${formatMoney(order.subtotal)}`);
    lines.push(`Descuento: -${formatMoney(order.discountAmount)}`);
  }
  lines.push(`*Total: ${formatMoney(order.total)}*`);
  if (order.notes) {
    lines.push("", `📝 ${order.notes}`);
  }

  return `https://wa.me/${number}?text=${encodeURIComponent(lines.join("\n"))}`;
}
