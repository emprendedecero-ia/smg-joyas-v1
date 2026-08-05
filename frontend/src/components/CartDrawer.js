"use client";

import { useState } from "react";
import {
  MAX_QTY,
  buildWhatsAppUrl,
  fetchJson,
  formatMoney,
  invoiceUrl,
} from "@/lib/api";
import { useCart } from "@/lib/cart";

export default function CartDrawer({ onClose }) {
  const { items, updateQuantity, removeItem, clear, totalAmount } = useCart();
  const [customerName, setCustomerName] = useState("");
  const [notes, setNotes] = useState("");
  const [discountMode, setDiscountMode] = useState("none"); // none | percent | amount
  const [discountValue, setDiscountValue] = useState("");
  const [step, setStep] = useState("cart");
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState(null);

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

  const downloadInvoice = async () => {
    if (!order) return;
    setDownloading(true);
    try {
      const response = await fetch(invoiceUrl(order.id));
      if (!response.ok) {
        throw new Error("No se pudo generar el presupuesto");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `presupuesto-SMG-${order.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
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
          <div className="drawer-body">
            {items.length === 0 ? (
              <div className="empty">
                <p className="empty-title">Tu carrito está vacío</p>
                <p className="empty-sub">Agregá productos desde el catálogo para armar tu pedido.</p>
              </div>
            ) : (
              <>
                <div className="cart-list">
                  {items.map((item) => (
                    <div className="cart-item" key={item.productId}>
                      <div>
                        <strong>{item.reference}</strong>
                        <div className="cart-item-desc">{item.description}</div>
                        <div>{formatMoney(item.priceWholesale)} c/u</div>
                      </div>
                      <input
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
                      <button
                        className="btn btn-outline"
                        onClick={() => removeItem(item.productId)}
                      >
                        Quitar
                      </button>
                    </div>
                  ))}
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
                  </div>
                )}

                {error && <p className="form-error" style={{ marginTop: "0.9rem" }}>{error}</p>}
              </>
            )}
          </div>
        )}

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
                <button className="btn btn-primary" disabled={downloading} onClick={downloadInvoice}>
                  {downloading ? "Generando..." : "Descargar presupuesto PDF"}
                </button>
              </div>
              <p className="invoice-hint">
                Adjuntá el presupuesto descargado al chat de WhatsApp para enviarlo al cliente.
              </p>
            </>
          ) : (
            items.length > 0 && (
              <>
                <div className="cart-totals">
                  {step === "checkout" ? (
                    <>
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
                    </>
                  ) : null}
                  <div className="cart-total">
                    <span>Total{step === "checkout" ? " final" : ""}</span>
                    <span>{formatMoney(step === "checkout" ? finalTotal : subtotal)}</span>
                  </div>
                </div>
                <div className="modal-actions">
                  {step === "cart" ? (
                    <button className="btn btn-primary block" onClick={() => setStep("checkout")}>
                      Continuar
                    </button>
                  ) : (
                    <>
                      <button className="btn btn-outline" onClick={() => setStep("cart")}>
                        Volver
                      </button>
                      <button
                        className="btn btn-primary"
                        disabled={loading}
                        onClick={handleCheckout}
                      >
                        {loading ? "Enviando..." : "Confirmar pedido"}
                      </button>
                    </>
                  )}
                </div>
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
