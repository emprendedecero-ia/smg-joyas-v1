"use client";

import { useEffect, useRef, useState } from "react";
import {
  MAX_QTY,
  buildWhatsAppUrl,
  fetchJson,
  formatMoney,
  invoiceUrl,
} from "@/lib/api";
import { useCart } from "@/lib/cart";

export default function CartDrawer({ onClose }) {
  const { items, updateQuantity, updatePrice, removeItem, clear, totalAmount } = useCart();
  const [customerName, setCustomerName] = useState("");
  const [notes, setNotes] = useState("");
  const [discountMode, setDiscountMode] = useState("none"); // none | percent | amount
  const [discountValue, setDiscountValue] = useState("");
  const [step, setStep] = useState("cart");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState(null);
  const bodyRef = useRef(null);

  // Al pasar a "Confirmar pedido" se arranca desde arriba del scroll, así se
  // ve primero el campo del cliente (y se revisa todo antes de confirmar).
  useEffect(() => {
    if (step === "checkout" && bodyRef.current) {
      bodyRef.current.scrollTop = 0;
    }
  }, [step]);

  const subtotal = totalAmount;
  const parsedDiscount = Number(discountValue);
  const discountAmount =
    discountMode === "percent" && parsedDiscount > 0
      ? Math.min(subtotal, Math.round((subtotal * parsedDiscount) / 100))
      : discountMode === "amount" && parsedDiscount > 0
      ? Math.min(subtotal, Math.round(parsedDiscount * 100) / 100)
      : 0;
  const finalTotal = Math.max(0, subtotal - discountAmount);

  const discountLabel =
    discountMode === "percent"
      ? `${parsedDiscount}%`
      : discountMode === "amount"
      ? formatMoney(discountAmount)
      : "";

  const handleCheckout = async () => {
    setError("");
    if (!customerName.trim()) {
      setError("Ingresá el nombre del cliente antes de confirmar el pedido.");
      return;
    }

    setLoading(true);
    try {
      const created = await fetchJson("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          customerName: customerName.trim(),
          items: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            // Precio preferencial: si el precio quedó vacío, el backend usa el
            // mayorista vigente del producto.
            unitPrice:
              item.unitPrice === "" || item.unitPrice == null
                ? undefined
                : Number(item.unitPrice),
          })),
          discountType: discountMode === "none" ? null : discountMode,
          discountValue: discountMode === "none" ? 0 : parsedDiscount || 0,
          notes: notes.trim(),
        }),
      });

      setOrder(created);
      setStep("success");
      clear();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Descarga NATIVA del navegador: el endpoint de presupuesto es público y
  // manda Content-Disposition: attachment, así el PDF baja solo (mismo fix que
  // el export de Excel; fetch+blob se bloquea silenciosamente en algunos
  // navegadores).
  const downloadInvoice = () => {
    if (!order) return;
    const link = document.createElement("a");
    link.href = invoiceUrl(order.id);
    link.download = `presupuesto-SMG-${order.id}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const openWhatsApp = () => {
    if (!order) return;
    const whatsappUrl = buildWhatsAppUrl(order, order.customerName);
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
    onClose();
  };

  const finishOrder = () => {
    onClose();
  };

  const title =
    step === "success" ? "Pedido confirmado" : step === "checkout" ? "Confirmar pedido" : "Tu carrito";
  const handleClose = step === "success" ? finishOrder : onClose;

  return (
    <div className="overlay drawer-overlay" onClick={step === "success" ? undefined : onClose}>
      <div className="drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <h2 className="drawer-title">{title}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={handleClose}
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        {step === "success" && order ? (
          <div className="drawer-body">
            <div className="success-badge">✓</div>
            <p style={{ margin: "0 0 1.2rem", textAlign: "center" }}>
              Pedido <strong>#{order.id}</strong> registrado. Descargá el presupuesto para
              entregarlo o adjuntarlo en WhatsApp.
            </p>
            <div className="cart-list">
              {order.items.map((item, index) => (
                <div className="cart-item" key={index}>
                  <div>
                    <strong>{item.reference}</strong>
                    <div className="cart-item-desc">{item.description}</div>
                    <div>{formatMoney(item.unitPrice)} c/u</div>
                  </div>
                  <span>x{item.quantity}</span>
                </div>
              ))}
            </div>
            {order.notes && <p className="order-notes" style={{ marginTop: "1rem" }}>📝 {order.notes}</p>}
            {error && <p className="form-error" style={{ marginTop: "0.9rem" }}>{error}</p>}
          </div>
        ) : (
          <div className="drawer-body" ref={bodyRef}>
            {items.length === 0 ? (
              <div className="empty">
                <p className="empty-title">Tu carrito está vacío</p>
                <p className="empty-sub">Agregá productos desde el catálogo para armar tu pedido.</p>
              </div>
            ) : (
              <>
                <div className="cart-list">
                  {items.map((item) => {
                    const unitPrice = item.unitPrice ?? item.priceWholesale;
                    const price =
                      unitPrice === "" || unitPrice == null
                        ? Number(item.priceWholesale)
                        : Number(unitPrice);
                    return (
                      <div className="cart-item" key={item.productId}>
                        <div className="cart-item-main">
                          <strong>{item.reference}</strong>
                          <div className="cart-item-desc">{item.description}</div>
                          <label className="cart-item-price">
                            <span className="cart-item-price-label">Precio c/u</span>
                            <input
                              type="number"
                              name="unitPrice"
                              min="0"
                              step="1"
                              inputMode="decimal"
                              value={unitPrice}
                              onChange={(event) =>
                                updatePrice(item.productId, event.target.value)
                              }
                              aria-label={`Precio unitario de ${item.reference}`}
                            />
                          </label>
                        </div>
                        <div className="cart-item-side">
                          <input
                            className="cart-item-qty"
                            type="number"
                            name="quantity"
                            min="1"
                            max={MAX_QTY}
                            step="1"
                            value={item.quantity}
                            onChange={(event) =>
                              updateQuantity(item.productId, Number(event.target.value))
                            }
                            aria-label={`Cantidad de ${item.reference}`}
                          />
                          <span className="cart-item-sub">
                            {formatMoney(price * item.quantity)}
                          </span>
                          <button
                            className="btn btn-outline"
                            onClick={() => removeItem(item.productId)}
                          >
                            Quitar
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {step === "checkout" && (
                  <div className="form-grid" style={{ marginTop: "1.2rem" }}>
                    <label>
                      Cliente (nombre y apellido)
                      <input
                        name="customerName"
                        value={customerName}
                        onChange={(event) => setCustomerName(event.target.value)}
                        placeholder="Ej: María López"
                        autoFocus
                      />
                    </label>

                    <div className="discount-box">
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

                    {/* Totales dentro del contenido scrolleable: aunque el
                        teclado del celular tape el pie, el total final siempre
                        se puede ver bajando la lista. */}
                    <div className="cart-totals checkout-totals">
                      <div className="cart-line">
                        <span>Subtotal</span>
                        <span>{formatMoney(subtotal)}</span>
                      </div>
                      {discountAmount > 0 && (
                        <div className="cart-line discount">
                          <span>Descuento ({discountLabel})</span>
                          <span>− {formatMoney(discountAmount)}</span>
                        </div>
                      )}
                      <div className="cart-total">
                        <span>Total final</span>
                        <span>{formatMoney(finalTotal)}</span>
                      </div>
                    </div>

                    {/* El error se muestra junto a la acción, al pie del
                        scroll: si falta el cliente o el pedido falla, se ve
                        al lado del botón Confirmar. */}
                    {error && (
                      <p className="form-error" style={{ margin: 0 }} aria-live="polite">
                        {error}
                      </p>
                    )}

                    {/* Volver y Confirmar van al final del scroll: se revisan
                        los datos y el total antes de confirmar, sin barra fija
                        que tape el teclado o la lista. */}
                    <div className="modal-actions checkout-actions">
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => {
                          setError("");
                          setStep("cart");
                        }}
                      >
                        Volver
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={loading}
                        onClick={handleCheckout}
                      >
                        {loading ? "Enviando..." : "Confirmar pedido"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* En el paso "Confirmar pedido" no hay barra fija: el total final y
            los botones van al final del contenido scrolleable (checkout-actions
            dentro del body), así el teclado y la lista no quedan tapados. */}
        {step !== "checkout" && (
          <div className="drawer-footer">
            {step === "success" && order ? (
              <>
                <div className="cart-totals">
                  <div className="cart-line">
                    <span>Subtotal</span>
                    <span>{formatMoney(order.subtotal)}</span>
                  </div>
                  {order.discountAmount > 0 && (
                    <div className="cart-line discount">
                      <span>Descuento</span>
                      <span>− {formatMoney(order.discountAmount)}</span>
                    </div>
                  )}
                  <div className="cart-total">
                    <span>Total</span>
                    <span>{formatMoney(order.total)}</span>
                  </div>
                </div>
                <div className="modal-actions">
                  <button className="btn btn-outline" onClick={openWhatsApp}>
                    WhatsApp
                  </button>
                  <button className="btn btn-primary" onClick={downloadInvoice}>
                    Descargar presupuesto PDF
                  </button>
                </div>
                <p className="invoice-hint">
                  Adjuntá el presupuesto descargado al chat de WhatsApp para enviarlo al cliente.
                </p>
              </>
            ) : (
              items.length > 0 && (
                <>
                  <div className="cart-total">
                    <span>Total</span>
                    <span>{formatMoney(subtotal)}</span>
                  </div>
                  <div className="modal-actions">
                    <button
                      className="btn btn-primary block"
                      onClick={() => {
                        setError("");
                        setStep("checkout");
                      }}
                    >
                      Continuar
                    </button>
                  </div>
                </>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
