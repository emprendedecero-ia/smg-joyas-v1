"use client";

import { useEffect, useMemo, useState } from "react";
import ProductCard from "@/components/ProductCard";
import ProductModal from "@/components/ProductModal";
import CartDrawer from "@/components/CartDrawer";
import { useCart } from "@/lib/cart";
import { fetchJson } from "@/lib/api";

function SearchIcon() {
  return (
    <svg
      className="search-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="21" r="1.6" />
      <circle cx="19" cy="21" r="1.6" />
      <path d="M2.5 3h2l2.6 12.4a2 2 0 0 0 2 1.6h9.2a2 2 0 0 0 2-1.6L22 7H6" />
    </svg>
  );
}

export default function CatalogApp({ initialProducts, categories: initialCategories }) {
  const [products, setProducts] = useState(initialProducts);
  const [categories, setCategories] = useState(initialCategories);
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const { addItem, totalItems } = useCart();

  // Si el SSR llegó vacío (por ejemplo porque la API gratuita estaba
  // "durmiendo" y despertó después del render del servidor), se recarga el
  // catálogo desde el navegador para no mostrar una página sin productos.
  useEffect(() => {
    if (initialProducts.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const [productsData, categoriesData] = await Promise.all([
          fetchJson("/api/products"),
          fetchJson("/api/categories"),
        ]);
        if (cancelled) return;
        setProducts(productsData);
        setCategories(categoriesData);
      } catch {
        // Silencioso: ya hay un estado vacío razonable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialProducts]);

  const filtered = useMemo(() => {
    return products.filter((product) => {
      const matchesCategory = !category || product.categorySlug === category;
      const q = query.trim().toLowerCase();
      const matchesQuery =
        !q ||
        product.reference.toLowerCase().includes(q) ||
        product.description.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [products, category, query]);

  return (
    <>
      <header className="site-header">
        <div className="header-inner container">
          <a href="/" className="brand" aria-label="SMG Joyería - Inicio">
            <img src="/logo.png" alt="SMG Joyería" className="logo" />
          </a>
          <div className="header-actions">
            <a className="btn btn-ghost" href="/admin">
              Admin
            </a>
            <button className="btn btn-primary cart-button" onClick={() => setCartOpen(true)}>
              <CartIcon />
              Carrito
              {totalItems > 0 && <span className="cart-badge">{totalItems}</span>}
            </button>
          </div>
        </div>
      </header>

      <main className="container">
        <section className="hero">
          <p className="hero-eyebrow">SMG Joyería</p>
          <h1 className="hero-title">Catálogo Mayorista</h1>
          <p className="hero-sub">
            Piezas seleccionadas al mejor precio para tu negocio. Hacé tu pedido y coordina la
            entrega por WhatsApp.
          </p>
          <div className="hero-rule" />
        </section>

        <div className="toolbar">
          <div className="search-box">
            <SearchIcon />
            <input
              type="search"
              name="search"
              placeholder="Buscar por código o descripción..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Buscar productos"
            />
          </div>
          <select
            className="category-select"
            name="category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-label="Filtrar por categoría"
          >
            <option value="">Todas las categorías</option>
            {categories.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name} ({item.product_count})
              </option>
            ))}
          </select>
        </div>

        <div className="filters chips-row">
          <button
            type="button"
            className={`chip ${category === "" ? "active" : ""}`}
            onClick={() => setCategory("")}
          >
            Todos
          </button>
          {categories.map((item) => (
            <button
              type="button"
              key={item.slug}
              className={`chip ${category === item.slug ? "active" : ""}`}
              onClick={() => setCategory(item.slug)}
            >
              {item.name}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="empty">
            <p className="empty-title">No encontramos productos</p>
            <p className="empty-sub">
              Probá con otro término de búsqueda o seleccioná otra categoría.
            </p>
          </div>
        ) : (
          <section className="grid" aria-label="Productos">
            {filtered.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onAdd={(item, qty) => addItem(item, qty)}
                onView={setSelectedProduct}
              />
            ))}
          </section>
        )}
      </main>

      <footer className="site-footer">
        <div className="container">
          <span className="brand-name">SMG Joyería</span> · Catálogo Mayorista · Precios en pesos
          argentinos
        </div>
      </footer>

      {selectedProduct && (
        <ProductModal
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onAdd={addItem}
        />
      )}

      {cartOpen && <CartDrawer onClose={() => setCartOpen(false)} />}
    </>
  );
}
