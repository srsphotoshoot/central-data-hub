/**
 * CDH (Central Data Hub) service
 * Connects directly to CDH API endpoints mapped in FastAPI.
 */

const getCdhBase = () => {
  if (window.location.port === '5173') {
    return 'http://localhost:8000/api/cdh';
  }
  return `${window.location.protocol}//${window.location.host}/cdh-api/api/cdh`;
};

const BASE = getCdhBase();

const call = async (path) => {
  const res = await fetch(`${BASE}${path}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 503) throw new Error('CDH_UNAVAILABLE');
  if (!res.ok) throw new Error(`CDH error ${res.status}`);
  return res.json();
};

const normalize = (raw) => {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw.length > 0 ? raw[0] : null;
  return raw.data ?? raw.challan ?? raw.result ?? raw;
};

// ── Challan lookup ────────────────────────────────────────────────────────────

export const lookupChallan = async (challanNo) => {
  const raw = await call(`/challans?challan_no=${encodeURIComponent(challanNo)}`);
  return normalize(raw);
};

export const lookupChallansByParty = async (partyName) => {
  const raw = await call(`/challans?customer=${encodeURIComponent(partyName)}`);
  return Array.isArray(raw) ? raw : (raw?.data ?? [raw].filter(Boolean));
};

// ── Sale orders ───────────────────────────────────────────────────────────────

export const getSaleOrders = async (customer) => {
  const raw = await call(`/sale-orders?customer=${encodeURIComponent(customer)}`);
  return Array.isArray(raw) ? raw : (raw?.data ?? []);
};

// ── Production ────────────────────────────────────────────────────────────────

export const getProduction = async (filters = {}) => {
  const params = new URLSearchParams(filters).toString();
  const raw = await call(`/production${params ? '?' + params : ''}`);
  return Array.isArray(raw) ? raw : (raw?.data ?? []);
};

// ── Product master ────────────────────────────────────────────────────────────

export const getProductMaster = async () => {
  const raw = await call('/products');
  return Array.isArray(raw) ? raw : (raw?.data ?? []);
};

// ── Raw material stock ────────────────────────────────────────────────────────

export const getRawMaterialStock = async () => {
  const raw = await call('/stock');
  return Array.isArray(raw) ? raw : (raw?.data ?? []);
};

// ── Customer ledger ───────────────────────────────────────────────────────────

export const getCustomerLedger = async (customer) => {
  const raw = await call(`/ledger/${encodeURIComponent(customer)}`);
  return normalize(raw);
};

// ── Return inward ─────────────────────────────────────────────────────────────

export const getReturnInward = async (customer) => {
  const raw = await call(`/returns?customer=${encodeURIComponent(customer)}`);
  return Array.isArray(raw) ? raw : (raw?.data ?? []);
};

// ── Map CDH challan → PassForm fields ────────────────────────────────────────
// CDH may use snake_case; form uses camelCase. This normalizes both.

export const mapChallanToForm = (cdh) => ({
  challanNo:     cdh.challan_no     ?? cdh.challanNo     ?? '',
  partyName:     cdh.customer_name  ?? cdh.partyName     ?? '',
  designNo:      cdh.item_design    ?? cdh.designNo      ?? '',
  date:          cdh.challan_date   ?? cdh.date          ?? new Date().toISOString().split('T')[0],
  description:   cdh.description    ?? cdh.item_name     ?? '',
  quantity:      String(cdh.quantity ?? ''),
  unitType:      cdh.unit_type      ?? cdh.unitType      ?? 'pcs',
  orderNo:       cdh.order_no       ?? cdh.orderNo       ?? '',
  transportName: cdh.transport_name ?? cdh.transportName ?? '',
  biltyNo:       cdh.bilty_no       ?? cdh.biltyNo       ?? '',
});
