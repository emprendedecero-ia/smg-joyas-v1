"use client";

import { useState } from "react";
import { assetUrl, formatMoney, MAX_QTY } from "@/lib/api";

export default function ProductModal({ product, onClose, onAdd }) {
  const [qty, setQty] = useState(1);
  if (!product) return null;

  const clampQty = (value) => Math.min(MAX_QTY, Math.max(1, Math.floor(value)));

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal product-modal" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Cerrar detalle"
        >
          ×
        </button>
        <div className="product-modal-body">
          <div className="product-modal-image">
            {product.imageUrl ? (
              <img src={assetUrl(product.imageUrl)} alt={product.reference} />
            ) : (
              <div className="missing">Sin imagen</div>
            )}
          </div>
          <div className="product-modal-info">
            <div className="cod">{product.reference}</div>
            <div className="desc">{product.description}</div>
            <div className="meta">
              {product.category}
              <span className={`stock-badge ${product.stock > 0 ? "stock-in" : "stock-out"}`}>
                {product.stock > 0 ? `${product.stock} en stock` : "Sin stock"}
              </span>
            </div>
            <div className="precio">
              Mayorista: {formatMoney(product.priceWholesale)}
            </div>
            <div className="stepper product-stepper">
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
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                onAdd(product, qty);
                onClose();
              }}
              disabled={product.stock < 1}
            >
              Agregar al carrito ({qty})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
