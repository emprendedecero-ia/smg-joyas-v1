"use client";

import { useState } from "react";
import { assetUrl, formatMoney, MAX_QTY } from "@/lib/api";

export default function ProductCard({ product, onAdd, onView }) {
  const outOfStock = product.stock < 1;
  const [picking, setPicking] = useState(false);
  const [qty, setQty] = useState(1);

  const clampQty = (value) => Math.min(MAX_QTY, Math.max(1, Math.floor(value)));

  const startPicking = () => {
    setQty(1);
    setPicking(true);
  };

  const cancelPicking = () => {
    setPicking(false);
    setQty(1);
  };

  const confirmAdd = () => {
    onAdd(product, qty);
    cancelPicking();
  };

  return (
    <article className="card">
      <button
        type="button"
        className="card-image card-image-btn"
        onClick={() => onView?.(product)}
        aria-label={`Ver detalle de ${product.reference}`}
      >
        {product.imageUrl ? (
          <img src={assetUrl(product.imageUrl)} alt={product.reference} loading="lazy" />
        ) : (
          <span className="missing">Sin imagen</span>
        )}
        {outOfStock && <span className="soldout-ribbon">Agotado</span>}
      </button>
      <div className="card-body">
        <div className="cod">{product.reference}</div>
        <div className="desc">{product.description}</div>
        <div className="precio">{formatMoney(product.priceWholesale)}</div>
        <div className="meta">
          <span>{product.category}</span>
          <span className={`stock-badge ${outOfStock ? "stock-out" : "stock-in"}`}>
            {outOfStock ? "Sin stock" : `${product.stock} en stock`}
          </span>
        </div>
        {picking ? (
          <div className="stepper">
            <div className="stepper-controls">
              <button
                type="button"
                className="stepper-btn"
                onClick={() => setQty((q) => clampQty(q - 1))}
                aria-label="Restar unidad"
              >
                −
              </button>
              <input
                type="number"
                className="stepper-input"
                min="1"
                max={MAX_QTY}
                step="1"
                value={qty}
                onChange={(event) => setQty(clampQty(Number(event.target.value) || 1))}
                aria-label={`Cantidad de ${product.reference}`}
              />
              <button
                type="button"
                className="stepper-btn"
                onClick={() => setQty((q) => clampQty(q + 1))}
                aria-label="Sumar unidad"
              >
                +
              </button>
              <button
                type="button"
                className="stepper-cancel"
                onClick={cancelPicking}
                aria-label="Cancelar selección de cantidad"
              >
                ×
              </button>
            </div>
            <button type="button" className="btn btn-primary stepper-confirm" onClick={confirmAdd}>
              Agregar {qty}
            </button>
          </div>
        ) : (
          <div className="qty-row">
            <button className="btn btn-outline" onClick={() => onView?.(product)}>
              Ver detalle
            </button>
            {/* Stock flexible: se puede vender aunque el stock viaje esté en 0
                o negativo (herramienta interna de presupuestos). */}
            <button className="btn btn-primary" onClick={startPicking}>
              Agregar
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
