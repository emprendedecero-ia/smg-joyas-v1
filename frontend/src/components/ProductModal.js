"use client";

import { assetUrl, formatMoney } from "@/lib/api";

export default function ProductModal({ product, onClose, onAdd }) {
  if (!product) return null;

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
            {product.priceRetail > 0 && (
              <div className="meta">
                Minorista: {formatMoney(product.priceRetail)}
              </div>
            )}
            {product.priceMl > 0 && (
              <div className="meta">
                MercadoLibre: {formatMoney(product.priceMl)}
              </div>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                onAdd(product, 1);
                onClose();
              }}
              disabled={product.stock < 1}
            >
              Agregar al carrito
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
