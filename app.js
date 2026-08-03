const defaultWhatsApp = '5491126151141';
const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const $ = (selector) => document.querySelector(selector);
const cart = JSON.parse(localStorage.getItem('smg-cart') || '{}');
let products = [];
let activeCategory = 'Todos';
let searchTerm = '';

function imageFor(product) { return product.imageUrl || `${product.code}.png`; }
function saveCart() { localStorage.setItem('smg-cart', JSON.stringify(cart)); }
function filteredProducts() { return products.filter((product) => (activeCategory === 'Todos' || product.category === activeCategory) && `${product.code} ${product.name}`.toLowerCase().includes(searchTerm)); }
function renderTabs() { const categories = ['Todos', ...new Set(products.map((product) => product.category))]; $('#category-tabs').innerHTML = categories.map((category) => `<button class="${category === activeCategory ? 'active' : ''}" data-category="${category}">${category}</button>`).join(''); }
function renderProducts() {
  const list = filteredProducts(); $('#product-count').textContent = `${list.length} productos`;
  $('#product-grid').innerHTML = list.map((product) => `<article class="product-card"><div class="product-image"><img src="${imageFor(product)}" alt="${product.name}" loading="lazy" /><button class="add-product" data-add="${product.code}" aria-label="Agregar ${product.code}" title="Agregar al carrito">+</button></div><div class="product-meta"><p class="product-category">${product.category}</p><strong class="product-name">${product.name}</strong><p class="product-price">${money.format(product.price)}</p></div></article>`).join('');
  $('#empty-state').hidden = list.length > 0;
}
function cartEntries() { return Object.entries(cart).map(([code, entry]) => { const product = products.find((item) => item.code === code); const quantity = typeof entry === 'number' ? entry : entry.quantity; const price = typeof entry === 'number' ? product?.price : entry.price; return product && quantity > 0 ? { product, quantity, price: Number(price) } : null; }).filter(Boolean); }
function discountTotal(subtotal) { const value = Math.max(0, Number($('#discount-value').value) || 0); return Math.min(subtotal, $('#discount-type').value === 'percent' ? subtotal * Math.min(value, 100) / 100 : value); }
function renderCart() {
  const entries = cartEntries(); const itemCount = entries.reduce((sum, item) => sum + item.quantity, 0); const subtotal = entries.reduce((sum, item) => sum + item.quantity * item.price, 0); const discount = discountTotal(subtotal);
  $('#cart-count').textContent = itemCount; $('#cart-total').textContent = money.format(subtotal - discount);
  $('#discount-summary').hidden = !discount; $('#discount-summary').textContent = `Descuento aplicado: -${money.format(discount)}`;
  $('#cart-items').innerHTML = entries.length ? entries.map(({ product, quantity, price }) => `<div class="cart-item"><img src="${imageFor(product)}" alt="${product.name}" /><div><h3>${product.name}</h3><label class="line-price">Precio unitario<input type="number" min="0" step="0.01" value="${price}" data-price="${product.code}" /></label><div class="cart-item-controls"><button data-change="${product.code}" data-amount="-1" aria-label="Quitar uno">−</button><span>${quantity}</span><button data-change="${product.code}" data-amount="1" aria-label="Sumar uno">+</button></div></div><button class="remove-item" data-remove="${product.code}" aria-label="Quitar producto">×</button></div>`).join('') : '<p class="cart-empty">Tu carrito está vacío.<br />Elegí las piezas que te gusten.</p>';
  saveCart();
}
function addToCart(code) { const product = products.find((item) => item.code === code); const old = cart[code]; cart[code] = { quantity: (typeof old === 'number' ? old : old?.quantity || 0) + 1, price: typeof old === 'object' ? old.price : product.price }; renderCart(); openCart(); }
function openCart() { $('#cart-drawer').classList.add('open'); $('#overlay').classList.add('show'); }
function closeCart() { $('#cart-drawer').classList.remove('open'); $('#overlay').classList.remove('show'); }
async function checkout() {
  const entries = cartEntries(); const customerName = $('#customer-name').value.trim();
  if (!entries.length) return; if (!customerName) { $('#customer-name').focus(); return; }
  const subtotal = entries.reduce((sum, item) => sum + item.quantity * item.price, 0); const discountValue = Math.max(0, Number($('#discount-value').value) || 0); const discountType = $('#discount-type').value;
  const payload = { customerName, discountType, discountValue, items: entries.map(({ product, quantity, price }) => ({ productId: product.id, code: product.code, name: product.name, quantity, unitPrice: price })) };
  const button = $('#checkout-button'); button.disabled = true; button.textContent = 'Guardando pedido...';
  try {
    const response = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const order = await response.json(); if (!response.ok) throw new Error(order.error);
    const discount = discountTotal(subtotal); const lines = entries.map(({ product, quantity, price }) => `• ${product.code} x${quantity} — ${money.format(price * quantity)}`).join('\n');
    const message = `Hola! Pedido #${order.id}%0ACliente: ${encodeURIComponent(customerName)}%0A%0A${encodeURIComponent(lines)}%0A%0ASubtotal: ${encodeURIComponent(money.format(subtotal))}${discount ? `%0ADescuento: -${encodeURIComponent(money.format(discount))}` : ''}%0ATotal: ${encodeURIComponent(money.format(subtotal - discount))}`;
    window.open(`https://wa.me/${defaultWhatsApp}?text=${message}`, '_blank', 'noopener');
  } catch (error) { alert(error.message || 'No se pudo guardar el pedido.'); } finally { button.disabled = false; button.innerHTML = 'Finalizar pedido por WhatsApp <span>↗</span>'; }
}
async function loadProducts() { try { const response = await fetch('/api/products'); if (!response.ok) throw new Error(); products = await response.json(); renderTabs(); renderProducts(); renderCart(); } catch { $('#product-grid').innerHTML = '<p class="empty-state">No pudimos cargar el catálogo. Intentá de nuevo más tarde.</p>'; } }
$('#category-tabs').addEventListener('click', (event) => { if (event.target.matches('[data-category]')) { activeCategory = event.target.dataset.category; renderTabs(); renderProducts(); } });
$('#product-grid').addEventListener('click', (event) => { const button = event.target.closest('[data-add]'); if (button) addToCart(button.dataset.add); });
$('#cart-items').addEventListener('input', (event) => { const input = event.target.closest('[data-price]'); if (input) { cart[input.dataset.price].price = Math.max(0, Number(input.value) || 0); saveCart(); renderCart(); } });
$('#cart-items').addEventListener('click', (event) => { const change = event.target.closest('[data-change]'); const remove = event.target.closest('[data-remove]'); if (change) { const code = change.dataset.change; const product = products.find((item) => item.code === code); const old = cart[code]; const item = typeof old === 'number' ? { quantity: old, price: product.price } : old; item.quantity += Number(change.dataset.amount); if (item.quantity < 1) delete cart[code]; else cart[code] = item; renderCart(); } if (remove) { delete cart[remove.dataset.remove]; renderCart(); } });
$('#discount-value').addEventListener('input', renderCart); $('#discount-type').addEventListener('change', renderCart); $('#search-input').addEventListener('input', (event) => { searchTerm = event.target.value.trim().toLowerCase(); renderProducts(); });
$('#search-button').addEventListener('click', () => { $('#search-input').focus(); $('#productos').scrollIntoView({ behavior: 'smooth' }); }); $('#open-cart').addEventListener('click', openCart); $('#overlay').addEventListener('click', closeCart); document.querySelector('[data-close-cart]').addEventListener('click', closeCart); $('#checkout-button').addEventListener('click', checkout);
loadProducts();
