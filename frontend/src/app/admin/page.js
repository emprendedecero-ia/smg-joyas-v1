"use client";

import { useEffect, useRef, useState } from "react";
import { buildWhatsAppUrl, fetchJson, formatMoney, invoiceUrl, MAX_QTY } from "@/lib/api";

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
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(new Set()); // ids con cambios sin guardar
  const [transferProduct, setTransferProduct] = useState(null);

  const load = async () => {
    try {
      setProducts(await authFetch("/api/admin/products"));
    } catch (err) {
      setError(err.message);
    }
  };

  const markDirty = (id) => setDirty((current) => new Set(current).add(id));
  const clearDirty = () => setDirty(new Set());

  const importExcel = async () => {
    // Reemplaza el catálogo con el Excel vigente (bijou.xlsx): reactiva los
    // productos del archivo y desactiva los que ya no figuren.
    if (
      !window.confirm(
        "¿Reemplazar el catálogo con el Excel (bijou.xlsx)? Se actualizan todos los productos del archivo (descripción, precios, stock y activación) y se desactivan los que ya no estén. El historial de pedidos no se toca."
      )
    ) {
      return;
    }
    setImporting(true);
    setError("");
    setMessage("");
    try {
      const result = await authFetch("/api/admin/import-excel", { method: "POST" });
      const parts = [`${result.imported} productos actualizados`];
      if (result.deactivated > 0) {
        parts.push(`${result.deactivated} desactivados`);
      }
      setMessage(`Catálogo reemplazado (${result.excel || "excel"}): ${parts.join(", ")}.`);
      clearDirty();
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

  const saveAll = async () => {
    const toSave = products.filter((product) => dirty.has(product.id));
    if (toSave.length === 0) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await authFetch("/api/admin/products/bulk", {
        method: "PUT",
        body: JSON.stringify({
          products: toSave.map((product) => ({
            id: product.id,
            description: product.description,
            stock: Number(product.stock),
            stockCasa: Number(product.stockCasa),
            // Costo vacío => null: el backend conserva el valor anterior
            cost: product.cost === "" ? null : Number(product.cost),
            priceWholesale: Number(product.priceWholesale),
            active: product.active,
          })),
        }),
      });
      setMessage(`Cambios guardados: ${result.updated} productos actualizados.`);
      clearDirty();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const discardChanges = async () => {
    clearDirty();
    setMessage("");
    setError("");
    await load();
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
      {dirty.size > 0 && (
        <div className="save-bar">
          <span>🖊️ {dirty.size} producto{dirty.size === 1 ? "" : "s"} modificado{dirty.size === 1 ? "" : "s"} sin guardar</span>
          <div className="save-bar-actions">
            <button className="btn btn-ghost" onClick={discardChanges} disabled={saving}>
              Descartar
            </button>
            <button className="btn btn-primary" onClick={saveAll} disabled={saving}>
              {saving ? "Guardando..." : `Guardar todos los cambios (${dirty.size})`}
            </button>
          </div>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Descripción</th>
              <th>Costo</th>
              <th>Stock viaje</th>
              <th>Stock casa</th>
              <th>Precio mayorista</th>
              <th>Ganancia/uni</th>
              <th>Activo</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9}>Sin resultados para esa búsqueda.</td>
              </tr>
            ) : null}
            {filtered.map((product) => (
              <tr key={product.id} className={dirty.has(product.id) ? "dirty-row" : ""}>
                <td>{product.reference}</td>
                <td>
                  <input
                    value={product.description}
                    onChange={(event) => {
                      markDirty(product.id);
                      setProducts((rows) =>
                        rows.map((row) =>
                          row.id === product.id
                            ? { ...row, description: event.target.value }
                            : row
                        )
                      );
                    }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    value={product.cost}
                    onChange={(event) => {
                      markDirty(product.id);
                      setProducts((rows) =>
                        rows.map((row) =>
                          row.id === product.id
                            ? { ...row, cost: event.target.value }
                            : row
                        )
                      );
                    }}
                    style={{ width: "100px" }}
                    aria-label={`Costo de ${product.reference}`}
                  />
                </td>
                <td>
                  <div className="stock-cell">
                    <input
                      type="number"
                      min="0"
                      value={product.stock}
                      onChange={(event) => {
                        markDirty(product.id);
                        setProducts((rows) =>
                          rows.map((row) =>
                            row.id === product.id
                              ? { ...row, stock: event.target.value }
                              : row
                          )
                        );
                      }}
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
                    onChange={(event) => {
                      markDirty(product.id);
                      setProducts((rows) =>
                        rows.map((row) =>
                          row.id === product.id
                            ? { ...row, stockCasa: event.target.value }
                            : row
                        )
                      );
                    }}
                    style={{ width: "72px" }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    value={product.priceWholesale}
                    onChange={(event) => {
                      markDirty(product.id);
                      setProducts((rows) =>
                        rows.map((row) =>
                          row.id === product.id
                            ? { ...row, priceWholesale: event.target.value }
                            : row
                        )
                      );
                    }}
                    style={{ width: "110px" }}
                  />
                </td>
                <td>
                  <span className={`profit-cell ${Number(product.priceWholesale) - Number(product.cost) < 0 ? "neg" : ""}`}>
                    {formatMoney(Number(product.priceWholesale) - Number(product.cost))}
                  </span>
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={product.active}
                    onChange={(event) => {
                      markDirty(product.id);
                      setProducts((rows) =>
                        rows.map((row) =>
                          row.id === product.id
                            ? { ...row, active: event.target.checked }
                            : row
                        )
                      );
                    }}
                  />
                </td>
                <td>
                  <button className="btn btn-outline" onClick={() => setTransferProduct(product)}>
                    Trasladar
                  </button>
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

const STATUS_LABELS = {
  pending: "Pendiente",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

function PdfIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 15h6M9 11h2" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.04 2a9.9 9.9 0 0 0-8.45 15.1L2 22l5.03-1.56A9.9 9.9 0 1 0 12.04 2Zm5.75 14.06c-.25.7-1.44 1.33-2 1.38-.55.05-1.06.25-3.56-.74-3-1.2-4.9-4.3-5.05-4.5-.15-.2-1.2-1.6-1.2-3.05 0-1.45.77-2.16 1.04-2.46.27-.3.6-.37.8-.37.2 0 .4 0 .57.01.19.01.44-.07.68.52.25.6.84 2.05.92 2.2.07.15.12.32.02.52-.1.2-.15.32-.3.5-.15.17-.32.39-.45.52-.15.15-.31.31-.13.61.18.3.79 1.3 1.7 2.1 1.17 1.05 2.16 1.37 2.47 1.53.3.15.48.13.66-.08.18-.2.76-.88.96-1.18.2-.3.4-.25.68-.15.27.1 1.73.82 2.03.97.3.15.5.22.57.35.08.12.08.72-.17 1.42Z" />
    </svg>
  );
}

function WhatsAppModal({ order, onClose }) {
  const [number, setNumber] = useState(process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "5491126151141");
  const [error, setError] = useState("");

  const send = () => {
    const clean = number.replace(/\D/g, "");
    if (clean.length < 8) {
      setError("Ingresá un número válido (solo dígitos, con código de país).");
      return;
    }
    window.open(buildWhatsAppUrl(order, order.customerName, clean), "_blank", "noopener,noreferrer");
    onClose();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal whatsapp-modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
          ×
        </button>
        <h2>Enviar presupuesto por WhatsApp</h2>
        <p className="transfer-product">
          Pedido #{order.id} — {order.customerName} · <strong>{formatMoney(order.total)}</strong>
        </p>
        <div className="form-grid">
          <label>
            Número de WhatsApp del destinatario
            <input
              type="tel"
              name="whatsappNumber"
              inputMode="tel"
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              placeholder="Ej: 5491126151141"
              autoFocus
            />
          </label>
        </div>
        <p className="form-hint">
          Solo dígitos, con código de país (ej: <strong>54911...</strong> para Argentina).
        </p>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={send}>
            Enviar por WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderEditModal({ order, onClose, onSaved }) {
  const [products, setProducts] = useState([]);
  const [customerName, setCustomerName] = useState(order.customerName);
  const [items, setItems] = useState([]);
  const [discountMode, setDiscountMode] = useState(order.discountType || "none");
  const [discountValue, setDiscountValue] = useState(order.discountValue || "");
  const [notes, setNotes] = useState(order.notes || "");
  const [addQuery, setAddQuery] = useState("");
  const addSearchRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const catalog = await authFetch("/api/admin/products");
        if (cancelled) return;
        // Se muestran los precios mayoristas vigentes; si el producto ya no
        // existe, se conserva el precio que tenía el pedido.
        const priceFor = (orderItem) => {
          const product = catalog.find((p) => p.id === orderItem.productId);
          return product ? Number(product.priceWholesale) : Number(orderItem.unitPrice);
        };
        setProducts(catalog);
        setItems(
          order.items.map((item) => ({
            productId: item.productId,
            reference: item.reference,
            description: item.description,
            quantity: item.quantity,
            unitPrice: priceFor(item),
          }))
        );
      } catch (err) {
        setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  // Cierra la búsqueda al hacer clic fuera del buscador (mousedown para que
  // corra antes que el click de los resultados, que usa preventDefault).
  useEffect(() => {
    const onOutside = (event) => {
      if (addSearchRef.current && !addSearchRef.current.contains(event.target)) {
        setAddQuery("");
      }
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const parsedDiscount = Number(discountValue);
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const discountAmount =
    discountMode === "percent" && parsedDiscount > 0
      ? Math.min(subtotal, Math.round((subtotal * parsedDiscount) / 100))
      : discountMode === "amount" && parsedDiscount > 0
      ? Math.min(subtotal, Math.round(parsedDiscount * 100) / 100)
      : 0;
  const total = Math.max(0, subtotal - discountAmount);

  const changeQuantity = (productId, quantity) =>
    setItems((current) =>
      current.map((item) =>
        item.productId === productId
          ? { ...item, quantity: Math.min(MAX_QTY, Math.max(1, Math.floor(Number(quantity) || 1))) }
          : item
      )
    );

  const removeItem = (productId) =>
    setItems((current) => current.filter((item) => item.productId !== productId));

  // Resultados de la búsqueda de productos para agregar: muestra hasta 8
  // coincidencias por código/descripción. Los que ya están en el pedido se
  // muestran igual (agregarlos otra vez suma +1 a la cantidad).
  const addResults = products
    .filter((product) => {
      const q = addQuery.trim().toLowerCase();
      if (!q) return false;
      return (
        product.reference.toLowerCase().includes(q) ||
        product.description.toLowerCase().includes(q)
      );
    })
    .slice(0, 8);

  const addProduct = (product) => {
    setItems((current) => {
      const existing = current.find((item) => item.productId === product.id);
      if (existing) {
        return current.map((item) =>
          item.productId === product.id
            ? { ...item, quantity: Math.min(MAX_QTY, item.quantity + 1) }
            : item
        );
      }
      return [
        ...current,
        {
          productId: product.id,
          reference: product.reference,
          description: product.description,
          quantity: 1,
          unitPrice: Number(product.priceWholesale),
        },
      ];
    });
    setAddQuery("");
  };

  const save = async () => {
    setError("");
    if (!customerName.trim()) {
      setError("El nombre del cliente es obligatorio.");
      return;
    }
    if (items.length === 0) {
      setError("El pedido debe tener al menos un producto.");
      return;
    }
    setLoading(true);
    try {
      await authFetch(`/api/orders/${order.id}`, {
        method: "PUT",
        body: JSON.stringify({
          customerName: customerName.trim(),
          items: items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
          discountType: discountMode === "none" ? null : discountMode,
          discountValue: discountMode === "none" ? 0 : parsedDiscount || 0,
          notes: notes.trim(),
        }),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal edit-modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
          ×
        </button>
        <h2>Editar pedido #{order.id}</h2>
        <p className="transfer-product">
          Los precios se recalculan con el precio mayorista vigente de cada producto.
        </p>
        {error && <p className="form-error">{error}</p>}
        <div className="form-grid">
          <label>
            Cliente (nombre y apellido)
            <input
              name="customerName"
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              placeholder="Ej: María López"
            />
          </label>
        </div>

        <div className="edit-items">
          {items.map((item) => (
            <div className="edit-item" key={item.productId}>
              <div>
                <div className="ref">{item.reference}</div>
                <div className="desc">{item.description}</div>
                <div>{formatMoney(item.unitPrice)} c/u</div>
              </div>
              <input
                type="number"
                name="quantity"
                min="1"
                max={MAX_QTY}
                step="1"
                value={item.quantity}
                onChange={(event) => changeQuantity(item.productId, event.target.value)}
                aria-label={`Cantidad de ${item.reference}`}
              />
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => removeItem(item.productId)}
              >
                Quitar
              </button>
            </div>
          ))}
          {items.length === 0 && <p className="muted-cell">Sin productos. Agregá al menos uno.</p>}
        </div>

        <div className="edit-add-row">
          <div className="product-search" ref={addSearchRef}>
            <input
              type="search"
              name="productSearch"
              value={addQuery}
              onChange={(event) => setAddQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && addResults.length > 0) {
                  event.preventDefault();
                  addProduct(addResults[0]);
                } else if (event.key === "Escape") {
                  setAddQuery("");
                }
              }}
              placeholder="Buscar producto por código o descripción..."
              aria-label="Buscar producto para agregar al pedido"
            />
            {addQuery.trim() && (
              <div className="product-search-results">
                {addResults.length === 0 ? (
                  <p className="product-search-empty">Sin resultados.</p>
                ) : (
                  addResults.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      className="product-search-result"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => addProduct(product)}
                    >
                      <span className="ref">{product.reference}</span>
                      <span className="product-name">{product.description}</span>
                      <span className="price">{formatMoney(product.priceWholesale)}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <div className="discount-box" style={{ marginTop: "0.9rem" }}>
          <span className="discount-box-label">Descuento sobre el total</span>
          <div className="discount-control">
            <div className="discount-modes">
              <button
                type="button"
                className={`mode-chip ${discountMode === "none" ? "active" : ""}`}
                onClick={() => {
                  setDiscountMode("none");
                  setDiscountValue("");
                }}
              >
                Sin
              </button>
              <button
                type="button"
                className={`mode-chip ${discountMode === "percent" ? "active" : ""}`}
                onClick={() => setDiscountMode("percent")}
              >
                %
              </button>
              <button
                type="button"
                className={`mode-chip ${discountMode === "amount" ? "active" : ""}`}
                onClick={() => setDiscountMode("amount")}
              >
                $
              </button>
            </div>
            <input
              type="number"
              name="discount"
              min="0"
              step={discountMode === "percent" ? "1" : "0.01"}
              inputMode="decimal"
              placeholder={discountMode === "percent" ? "10" : "0"}
              value={discountValue}
              onChange={(event) => setDiscountValue(event.target.value)}
              disabled={discountMode === "none"}
              aria-label="Valor del descuento"
            />
          </div>
          {discountAmount > 0 && (
            <p className="discount-summary">
              Se descuentan <strong>{formatMoney(discountAmount)}</strong>
              {discountMode === "percent" ? ` (${parsedDiscount}%)` : ""}
            </p>
          )}
        </div>

        <div className="form-grid" style={{ marginTop: "0.9rem" }}>
          <label>
            Observación / comentario
            <textarea
              name="notes"
              rows="2"
              maxLength="300"
              placeholder="Ej: Entrega el jueves por la mañana, abonó en efectivo..."
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </div>

        <div className="cart-totals" style={{ marginTop: "1rem" }}>
          <div className="cart-line">
            <span>Subtotal</span>
            <span>{formatMoney(subtotal)}</span>
          </div>
          {discountAmount > 0 && (
            <div className="cart-line discount">
              <span>Descuento</span>
              <span>− {formatMoney(discountAmount)}</span>
            </div>
          )}
          <div className="cart-total">
            <span>Total</span>
            <span>{formatMoney(total)}</span>
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" disabled={loading} onClick={save}>
            {loading ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OrdersPanel({ onChange }) {
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [editingOrder, setEditingOrder] = useState(null);
  const [whatsappOrder, setWhatsappOrder] = useState(null);

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
      onChange?.();
    } catch (err) {
      setError(err.message);
    }
  };

  const cancel = async (id) => {
    try {
      await authFetch(`/api/orders/${id}/cancel`, { method: "PATCH" });
      await load();
      onChange?.();
    } catch (err) {
      setError(err.message);
    }
  };

  const downloadInvoice = async (id) => {
    try {
      const response = await fetch(invoiceUrl(id));
      if (!response.ok) {
        throw new Error("No se pudo generar el presupuesto");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `presupuesto-SMG-${id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  };

  const restore = async (id) => {
    try {
      await authFetch(`/api/orders/${id}/restore`, { method: "PATCH" });
      await load();
      onChange?.();
    } catch (err) {
      setError(err.message);
    }
  };

  const reopen = async (id) => {
    try {
      await authFetch(`/api/orders/${id}/reopen`, { method: "PATCH" });
      await load();
      onChange?.();
    } catch (err) {
      setError(err.message);
    }
  };

  const exportCsv = () => {
    const rows = orders.map((order) => [
      order.id,
      order.customerName,
      STATUS_LABELS[order.status] || order.status,
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
                  <span className={`status ${order.status}`}>{STATUS_LABELS[order.status] || order.status}</span>
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
                  <div className="order-actions">
                    <div className="order-actions-row">
                      <button
                        type="button"
                        className="icon-btn"
                        title="Descargar presupuesto (PDF)"
                        aria-label={`Presupuesto PDF del pedido ${order.id}`}
                        onClick={() => downloadInvoice(order.id)}
                      >
                        <PdfIcon />
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn-wa"
                        title="Enviar por WhatsApp"
                        aria-label={`Enviar pedido ${order.id} por WhatsApp`}
                        onClick={() => setWhatsappOrder(order)}
                      >
                        <WhatsAppIcon />
                      </button>
                    </div>
                    {order.status === "pending" && (
                      <div className="order-actions-row">
                        <button className="btn btn-outline btn-sm" onClick={() => setEditingOrder(order)}>
                          Editar
                        </button>
                        <button className="btn btn-primary btn-sm" onClick={() => deliver(order.id)}>
                          Entregado
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => cancel(order.id)}>
                          Cancelar
                        </button>
                      </div>
                    )}
                    {order.status === "cancelled" && (
                      <div className="order-actions-row">
                        <button className="btn btn-outline btn-sm" onClick={() => restore(order.id)}>
                          Restablecer
                        </button>
                      </div>
                    )}
                    {order.status === "delivered" && (
                      <div className="order-actions-row">
                        <button className="btn btn-outline btn-sm" onClick={() => reopen(order.id)}>
                          Volver a Pendiente
                        </button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingOrder && (
        <OrderEditModal
          order={editingOrder}
          onClose={() => setEditingOrder(null)}
          onSaved={async () => {
            setEditingOrder(null);
            await load();
            onChange?.();
          }}
        />
      )}

      {whatsappOrder && (
        <WhatsAppModal order={whatsappOrder} onClose={() => setWhatsappOrder(null)} />
      )}
    </div>
  );
}

function SalesReport({ ordersVersion }) {
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

  // Si cambió algún pedido mientras este informe ya estaba generado (p.ej. se
  // marcó Entregado en la pestaña Pedidos), se regenera solo, sin F5.
  useEffect(() => {
    if (data) generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordersVersion]);

  const exportCsv = () => {
    if (!data) return;
    const header =
      data.groupBy === "product"
        ? ["Código", "Descripción", "Pedidos", "Unidades", "Facturado", "Costo", "Ganancia", "Stock viaje", "Stock casa"]
        : ["Cliente", "Pedidos", "Entregados", "Unidades", "Facturado", "Costo", "Ganancia"];
    const rows = data.rows.map((row) =>
      data.groupBy === "product"
        ? [
            row.reference,
            row.description,
            row.orders,
            row.units,
            row.revenue,
            row.cost,
            row.profit,
            row.stockViaje,
            row.stockCasa,
          ]
        : [row.customer, row.orders, row.deliveredOrders, row.units, row.revenue, row.cost, row.profit]
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
            <strong>Facturado: {formatMoney(data.totals.revenue)}</strong> ·{" "}
            Costo: {formatMoney(data.totals.cost)} ·{" "}
            <strong className="profit-total">Ganancia: {formatMoney(data.totals.profit)}</strong>
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
                      <th>Costo</th>
                      <th>Ganancia</th>
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
                      <th>Costo</th>
                      <th>Ganancia</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={data.groupBy === "product" ? 9 : 7}>Sin ventas en el período.</td>
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
                        <td>{formatMoney(row.cost)}</td>
                        <td className="profit-cell">{formatMoney(row.profit)}</td>
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
                        <td>{formatMoney(row.cost)}</td>
                        <td className="profit-cell">{formatMoney(row.profit)}</td>
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

function ReportsPanel({ ordersVersion }) {
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

  // Se recarga el resumen cuando cambia algún pedido (ver OrdersPanel.onChange).
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordersVersion]);

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

      <SalesReport ordersVersion={ordersVersion} />

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
          <span className="stat-label">Costo (entregado)</span>
          <span className="stat-value">{formatMoney(totals.deliveredCost)}</span>
        </div>
        <div className="stat-card stat-card-profit">
          <span className="stat-label">Ganancia (entregado)</span>
          <span className="stat-value">{formatMoney(totals.deliveredProfit)}</span>
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
  // Contador de cambios de pedidos: hace que Reportes se recargue solo.
  const [ordersVersion, setOrdersVersion] = useState(0);

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
      {/* Los paneles quedan montados (ocultos con CSS) para no perder ediciones
          sin guardar al cambiar de pestaña, por ejemplo en Productos. */}
      <div className="container">
        <div hidden={tab !== "orders"}>
          <OrdersPanel onChange={() => setOrdersVersion((v) => v + 1)} />
        </div>
        <div hidden={tab !== "products"}>
          <ProductsPanel />
        </div>
        <div hidden={tab !== "reports"}>
          <ReportsPanel ordersVersion={ordersVersion} />
        </div>
      </div>
    </div>
  );
}
