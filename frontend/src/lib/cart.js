"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { MAX_QTY } from "./api";

const CartContext = createContext(null);
const STORAGE_KEY = "smg-cart";

export function CartProvider({ children }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const value = useMemo(() => {
    const addItem = (product, quantity = 1) => {
      const qty = Math.min(MAX_QTY, Math.max(1, Math.floor(quantity)));
      setItems((current) => {
        const existing = current.find((item) => item.productId === product.id);
        if (existing) {
          const nextQty = Math.min(MAX_QTY, existing.quantity + qty);
          return current.map((item) =>
            item.productId === product.id ? { ...item, quantity: nextQty } : item
          );
        }
        return [
          ...current,
          {
            productId: product.id,
            reference: product.reference,
            description: product.description,
            priceWholesale: product.priceWholesale,
            unitPrice: product.priceWholesale,
            imageUrl: product.imageUrl,
            quantity: qty,
          },
        ];
      });
    };

    const updateQuantity = (productId, quantity) => {
      const qty = Math.min(MAX_QTY, Math.max(1, Math.floor(quantity)));
      setItems((current) =>
        current.map((item) =>
          item.productId === productId ? { ...item, quantity: qty } : item
        )
      );
    };

    // Precio preferencial por producto: se puede ajustar el precio unitario
    // para clientes con acuerdos especiales (el carrito lo manda al pedido).
    // Se guarda el valor tal como se tipea (puede quedar vacío mientras se
    // edita); vacío = se usa el mayorista al confirmar.
    const updatePrice = (productId, unitPrice) => {
      setItems((current) =>
        current.map((item) =>
          item.productId === productId ? { ...item, unitPrice } : item
        )
      );
    };

    const removeItem = (productId) => {
      setItems((current) => current.filter((item) => item.productId !== productId));
    };

    const clear = () => setItems([]);

    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
    const totalAmount = items.reduce((sum, item) => {
      const raw = item.unitPrice ?? item.priceWholesale;
      const price =
        raw === "" || raw == null ? Number(item.priceWholesale) : Number(raw);
      return sum + item.quantity * (Number.isFinite(price) ? price : 0);
    }, 0);

    return {
      items,
      addItem,
      updateQuantity,
      updatePrice,
      removeItem,
      clear,
      totalItems,
      totalAmount,
    };
  }, [items]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart debe usarse dentro de CartProvider");
  }
  return context;
}
