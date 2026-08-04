"use client";

import { assetUrl, formatMoney } from "@/lib/api";

export default function ProductCard({ product, onAdd, onView }) {
  const outOfStock = product.stock < 1;

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
        <div className="qty-row">
          <button className="btn btn-outline" onClick={() => onView?.(product)}>
            Ver detalle
          </button>
          {/* Stock flexible: se puede vender aunque el stock viaje esté en 0
              o negativo (herramienta interna de facturación). */}
          <button className="btn btn-primary" onClick={() => onAdd(product, 1)}>
            Agregar
          </button>
        </div>
      </div>
    </article>
  );
}
