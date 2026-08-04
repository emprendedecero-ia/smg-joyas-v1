"use client";

import { useEffect, useState } from "react";
import { fetchJson, formatMoney, invoiceUrl } from "@/lib/api";

const TOKEN_KEY = "smg-admin-token";

function getToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(TOKEN_KEY) || "";
}

function authFetch(path, options = {}) {
  return fetchJson(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      ...(options.headers || {}),
    },
  });
}

function downloadCsv(filename, rows) {
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = rows.map((row) => row.map(escape).join(";")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function LoginForm({ onSuccess }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await fetchJson("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <div className="login-card">
        <img src="/logo.png" alt="SMG Joyería" className="login-logo" />
        <h2 className="login-title">Panel de administración</h2>
        <form className="form-grid" onSubmit={submit}>
          <label>
            Contraseña
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="btn btn-primary" disabled={loading}>
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
      </div>
    </div>
  );
}

function TransferModal({ product, onClose, onDone, onError }) {
  const [from, setFrom] = useState("casa");
  const [quantity, setQuantity] = useState("");
  const [loading, setLoading] = useState(false);

  const to = from === "casa" ? "viaje" : "casa";

  const submit = async (event) => {
    event.preventDefault();
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) return;
    setLoading(true);
    try {
      await authFetch(`/api/admin/products/${product.id}/transfer`, {
        method: "POST",
        body: JSON.stringify({ from, to, quantity: qty }),
      });
      onDone();
    } catch (err) {
      onError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal transfer-modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
          ×
        </button>
        <h2>Trasladar stock</h2>
        <p className="transfer-product">
          {product.reference} — {product.description}
        </p>
        <div className="transfer-stocks">
          <div className="transfer-stock">
            <span>Casa</span>
            <strong>{product.stockCasa}</strong>
          </div>
          <span className="transfer-arrow">→</span>
          <div className="transfer-stock">
            <span>Viaje</span>
            <strong>{product.stock}</strong>
          </div>
        </div>
        <form className="form-grid" onSubmit={submit} style={{ marginTop: "1rem" }}>
          <label>
            Dirección
            <select name="transferFrom" value={from} onChange={(event) => setFrom(event.target.value)}>
              <option value="casa">Casa → Viaje (reponer el bolso)</option>
              <option value="viaje">Viaje → Casa (mercadería devuelta)</option>
            </select>
          </label>
          <label>
            Cantidad
            <input
              type="number"
              name="transferQty"
              min="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              autoFocus
            />
          </label>
          <button className="btn btn-primary" disabled={loading}>
            {loading ? "Trasladando..." : `Trasladar a ${to}`}
          </button>
        </form>
      </div>
    </div>
  );
}

function ProductsPanel() {
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const [transferProduct, setTransferProduct] = useState(null);

  const load = async () => {
    try {
      setProducts(await authFetch("/api/admin/products"));
    } catch (err) {
      setError(err.message);
    }
  };

  const importExcel = async () => {
    setImporting(true);
    setError("");
    setMessage("");
    try {
      const result = await authFetch("/api/admin/import-excel", { method: "POST" });
      setMessage(`Excel importado: ${result.imported} productos actualizados.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (product) => {
    try {
      await authFetch(`/api/admin/products/${product.id}`, {
        method: "PUT",
        body: JSON.stringify({
          description: product.description,
          stock: Number(product.stock),
          stockCasa: Number(product.stockCasa),
          priceWholesale: Number(product.priceWholesale),
          active: product.active,
        }),
      });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const filtered = products.filter((product) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      product.reference.toLowerCase().includes(q) ||
      product.description.toLowerCase().includes(q) ||
      (product.category || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        <h2>Productos</h2>
        <button className="btn btn-outline" onClick={importExcel} disabled={importing}>
          {importing ? "Importando..." : "Importar desde Excel"}
        </button>
      </div>
      {error && <p style={{ color: "#b33" }}>{error}</p>}
      {message && <p style={{ color: "#155724" }}>{message}</p>}
      <div className="filters" style={{ marginBottom: "1rem" }}>
        <input
          type="search"
          name="productSearch"
          className="admin-search"
          placeholder="Buscar por código, descripción o categoría..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="admin-count">
          {filtered.length} de {products.length} productos
        </span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Descripción</th>
              <th>Stock viaje</th>
              <th>Stock casa</th>
              <th>Precio mayorista</th>
              <th>Activo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7}>Sin resultados para esa búsqueda.</td>
              </tr>
            ) : null}
            {filtered.map((product) => (
              <tr key={product.id}>
                <td>{product.reference}</td>
                <td>
                  <input
                    value={product.description}
                    onChange={(event) =>
                      setProducts((rows) =>
                        rows.map((row) =>
                          row.id === product.id
                            ? { ...row, description: event.target.value }
                            : row
                        )
                      )
                    }
                  />
                </td>
                <td>
                  <div className="stock-cell">
                    <input
                      type="number"
                      min="0"
                      value={product.stock}
                      onChange={(event) =>
                        setProducts((rows) =>
                          rows.map((row) =>
                            row.id === product.id
                              ? { ...row, stock: event.target.value }
                              : row
                          )
                        )
                      }
                      style={{ width: "72px" }}
                    />
                    {product.stock <= 0 && (
                      <span className="stock-warn">sin stock</span>
                    )}
                  </div>
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    value={product.stockCasa}
                    onChange={(event) =>
                      setProducts((rows) =>
                        rows.map((row) =>
                          row.id === product.id
                            ? { ...row, stockCasa: event.target.value }
                            : row
                        )
                      )
                    }
                    style={{ width: "72px" }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    value={product.priceWholesale}
                    onChange={(event) =>
                      setProducts((rows) =>
                        rows.map((row) =>
                          row.id === product.id
                            ? { ...row, priceWholesale: event.target.value }
                            : row
                        )
                      )
                    }
                    style={{ width: "110px" }}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={product.active}
                    onChange={(event) =>
                      setProducts((rows) =>
                        rows.map((row) =>
                          row.id === product.id
                            ? { ...row, active: event.target.checked }
                            : row
                        )
                      )
                    }
                  />
                </td>
                <td>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button className="btn btn-outline" onClick={() => setTransferProduct(product)}>
                      Trasladar
                    </button>
                    <button className="btn btn-primary" onClick={() => save(product)}>
                      Guardar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {transferProduct && (
        <TransferModal
          product={transferProduct}
          onClose={() => setTransferProduct(null)}
          onDone={async () => {
            setTransferProduct(null);
            await load();
          }}
          onError={(msg) => setError(msg)}
        />
      )}
    </div>
  );
}

function OrdersPanel() {
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const path = filter ? `/api/orders?status=${filter}` : "/api/orders";
      setOrders(await authFetch(path));
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, [filter]);

  const deliver = async (id) => {
    try {
      await authFetch(`/api/orders/${id}/deliver`, { method: "PATCH" });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const cancel = async (id) => {
    try {
      await authFetch(`/api/orders/${id}/cancel`, { method: "PATCH" });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const downloadInvoice = async (id) => {
    try {
      const response = await fetch(invoiceUrl(id));
      if (!response.ok) {
        throw new Error("No se pudo generar la factura");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `factura-SMG-${id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  };

  const exportCsv = () => {
    const rows = orders.map((order) => [
      order.id,
      order.customerName,
      order.status,
      order.subtotal,
      order.discountAmount,
      order.total,
      order.notes || "",
      new Date(order.createdAt).toLocaleString("es-AR"),
      order.items.map((item) => `${item.reference} x${item.quantity}`).join(" | "),
    ]);

    downloadCsv(
      `pedidos-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        ["Nro", "Cliente", "Estado", "Subtotal", "Descuento", "Total", "Observaciones", "Fecha", "Productos"],
        ...rows,
      ]
    );
  };

  return (
    <div className="admin-panel">
      <h2>Pedidos</h2>
      <div className="filters" style={{ marginBottom: "1rem" }}>
        <select value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="">Todos</option>
          <option value="pending">Pendientes</option>
          <option value="delivered">Entregados</option>
          <option value="cancelled">Cancelados</option>
        </select>
        <button className="btn btn-outline" onClick={load}>
          Actualizar
        </button>
        <button className="btn btn-outline" onClick={exportCsv}>
          Exportar CSV
        </button>
      </div>
      {error && <p style={{ color: "#b33" }}>{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Cliente</th>
              <th>Estado</th>
              <th>Subtotal</th>
              <th>Desc.</th>
              <th>Total</th>
              <th>Items</th>
              <th>Fecha</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td>{order.id}</td>
                <td>{order.customerName}</td>
                <td>
                  <span className={`status ${order.status}`}>{order.status}</span>
                </td>
                <td>{formatMoney(order.subtotal)}</td>
                <td>
                  {order.discountAmount > 0 ? (
                    <span className="discount-cell">− {formatMoney(order.discountAmount)}</span>
                  ) : (
                    <span className="muted-cell">—</span>
                  )}
                </td>
                <td>
                  <strong>{formatMoney(order.total)}</strong>
                </td>
                <td>
                  <ul style={{ margin: 0, paddingLeft: "1rem" }}>
                    {order.items.map((item) => (
                      <li key={item.id}>
                        {item.reference} x{item.quantity}
                      </li>
                    ))}
                  </ul>
                  {order.notes && <p className="order-notes">📝 {order.notes}</p>}
                </td>
                <td>{new Date(order.createdAt).toLocaleString("es-AR")}</td>
                <td>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button className="btn btn-outline" onClick={() => downloadInvoice(order.id)}>
                      Factura
                    </button>
                    {order.status === "pending" && (
                      <>
                        <button className="btn btn-primary" onClick={() => deliver(order.id)}>
                          Entregado
                        </button>
                        <button className="btn btn-danger" onClick={() => cancel(order.id)}>
                          Cancelar
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SalesReport() {
  // Fechas en hora local (toISOString usa UTC y desfasa un día en AR).
  const toLocalDate = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };
  const today = () => toLocalDate(new Date());
  const thirtyDaysAgo = () => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return toLocalDate(date);
  };

  const [from, setFrom] = useState(thirtyDaysAgo);
  const [to, setTo] = useState(today);
  const [groupBy, setGroupBy] = useState("product");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const generate = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ from, to, groupBy });
      setData(await authFetch(`/api/admin/reports/sales?${params}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    if (!data) return;
    const header =
      data.groupBy === "product"
        ? ["Código", "Descripción", "Pedidos", "Unidades", "Facturado", "Stock viaje", "Stock casa"]
        : ["Cliente", "Pedidos", "Entregados", "Unidades", "Facturado"];
    const rows = data.rows.map((row) =>
      data.groupBy === "product"
        ? [row.reference, row.description, row.orders, row.units, row.revenue, row.stockViaje, row.stockCasa]
        : [row.customer, row.orders, row.deliveredOrders, row.units, row.revenue]
    );
    downloadCsv(`ventas-${from}-${to}.csv`, [header, ...rows]);
  };

  return (
    <section className="admin-section">
      <h3>Informe de ventas</h3>
      <p className="report-hint">
        Para saber cuánto reponer o pedir a fábrica: elegí el período y agrupá por producto o cliente.
      </p>
      <div className="filters report-filters">
        <label className="report-date">
          Desde
          <input type="date" name="from" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="report-date">
          Hasta
          <input type="date" name="to" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <select
          value={groupBy}
          onChange={(event) => setGroupBy(event.target.value)}
          aria-label="Agrupar por"
        >
          <option value="product">Por producto</option>
          <option value="client">Por cliente</option>
        </select>
        <button className="btn btn-primary" onClick={generate} disabled={loading}>
          {loading ? "Generando..." : "Generar"}
        </button>
      </div>
      {error && <p style={{ color: "#b33" }}>{error}</p>}

      {data && (
        <>
          <p className="report-totals">
            Período {data.from} → {data.to} · {data.totals.orders} pedidos
            {data.totals.units != null ? ` · ${data.totals.units} unidades` : ""} ·{" "}
            <strong>Facturado: {formatMoney(data.totals.revenue)}</strong>
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {data.groupBy === "product" ? (
                    <>
                      <th>Código</th>
                      <th>Descripción</th>
                      <th>Pedidos</th>
                      <th>Unidades</th>
                      <th>Facturado</th>
                      <th>Stock viaje</th>
                      <th>Stock casa</th>
                    </>
                  ) : (
                    <>
                      <th>Cliente</th>
                      <th>Pedidos</th>
                      <th>Entregados</th>
                      <th>Unidades</th>
                      <th>Facturado</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={data.groupBy === "product" ? 7 : 5}>Sin ventas en el período.</td>
                  </tr>
                ) : (
                  data.rows.map((row, index) =>
                    data.groupBy === "product" ? (
                      <tr key={row.reference}>
                        <td>{row.reference}</td>
                        <td>{row.description}</td>
                        <td>{row.orders}</td>
                        <td>{row.units}</td>
                        <td>{formatMoney(row.revenue)}</td>
                        <td className={row.stockViaje <= 0 ? "stock-warn-cell" : ""}>{row.stockViaje}</td>
                        <td>{row.stockCasa}</td>
                      </tr>
                    ) : (
                      <tr key={index}>
                        <td>{row.customer}</td>
                        <td>{row.orders}</td>
                        <td>{row.deliveredOrders}</td>
                        <td>{row.units}</td>
                        <td>{formatMoney(row.revenue)}</td>
                      </tr>
                    )
                  )
                )}
              </tbody>
            </table>
          </div>
          {data.rows.length > 0 && (
            <button className="btn btn-outline" style={{ marginTop: "0.9rem" }} onClick={exportCsv}>
              Exportar CSV
            </button>
          )}
        </>
      )}
    </section>
  );
}

function ReportsPanel() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    try {
      setReport(await authFetch("/api/admin/reports/summary"));
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (!report) {
    return (
      <div className="admin-panel">
        <h2>Reportes</h2>
        {error && <p style={{ color: "#b33" }}>{error}</p>}
        <p>Cargando...</p>
      </div>
    );
  }

  const { totals, topProducts, daily } = report;

  return (
    <div className="admin-panel">
      <h2>Reportes</h2>
      {error && <p style={{ color: "#b33" }}>{error}</p>}

      <SalesReport />

      <h3>Resumen general</h3>
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">Pedidos totales</span>
          <span className="stat-value">{totals.totalOrders}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Pendientes</span>
          <span className="stat-value">{totals.pending}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Entregados</span>
          <span className="stat-value">{totals.delivered}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Cancelados</span>
          <span className="stat-value">{totals.cancelled}</span>
        </div>
        <div className="stat-card stat-card-highlight">
          <span className="stat-label">Vendido (entregado)</span>
          <span className="stat-value">{formatMoney(totals.deliveredRevenue)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">En curso (pendiente)</span>
          <span className="stat-value">{formatMoney(totals.pendingRevenue)}</span>
        </div>
      </div>

      <h3>Top productos</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Descripción</th>
              <th>Unidades</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {topProducts.length === 0 ? (
              <tr>
                <td colSpan={4}>Sin ventas todavía.</td>
              </tr>
            ) : (
              topProducts.map((row) => (
                <tr key={row.reference}>
                  <td>{row.reference}</td>
                  <td>{row.description}</td>
                  <td>{row.units}</td>
                  <td>{formatMoney(row.total)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h3>Últimos 30 días</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Día</th>
              <th>Pedidos</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {daily.length === 0 ? (
              <tr>
                <td colSpan={3}>Sin actividad en los últimos 30 días.</td>
              </tr>
            ) : (
              daily.map((row) => (
                <tr key={row.day}>
                  <td>{row.day}</td>
                  <td>{row.orders}</td>
                  <td>{formatMoney(row.total)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState("orders");

  useEffect(() => {
    setAuthed(Boolean(getToken()));
  }, []);

  if (!authed) {
    return (
      <div className="admin-layout">
        <LoginForm onSuccess={() => setAuthed(true)} />
      </div>
    );
  }

  return (
    <div className="admin-layout">
      <nav className="admin-nav container">
        <a href="/" className="admin-brand">SMG Joyería</a>
        <a className="btn btn-ghost" href="/">
          Ver catálogo
        </a>
        <button
          className={`chip ${tab === "orders" ? "active" : ""}`}
          onClick={() => setTab("orders")}
        >
          Pedidos
        </button>
        <button
          className={`chip ${tab === "products" ? "active" : ""}`}
          onClick={() => setTab("products")}
        >
          Productos
        </button>
        <button
          className={`chip ${tab === "reports" ? "active" : ""}`}
          onClick={() => setTab("reports")}
        >
          Reportes
        </button>
        <button
          className="btn btn-outline"
          onClick={() => {
            localStorage.removeItem(TOKEN_KEY);
            setAuthed(false);
          }}
        >
          Salir
        </button>
      </nav>
      <div className="container">
        {tab === "orders" && <OrdersPanel />}
        {tab === "products" && <ProductsPanel />}
        {tab === "reports" && <ReportsPanel />}
      </div>
    </div>
  );
}
