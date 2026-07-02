export const DEPT_OPTIONS = [
  { value: 'godown',     label: 'Godown / Stocks' },
  { value: 'accounts',  label: 'Accounts' },
  { value: 'production', label: 'Production' },
  { value: 'dispatch',  label: 'Dispatch' },
];

export const DEPT_CONFIG = {
  godown: {
    label: 'Godown / Stocks',
    dashboardTitle: 'Stock & Inventory Dashboard',
    incomingLabel: 'Stock Received Today',
    outgoingLabel: 'Stock Dispatched Today',
    pendingLabel: 'Pending Clearances',
    description: 'Monitor inbound and outbound stock movement',
    color: '#10b981',
    glow: 'rgba(16, 185, 129, 0.25)',
    bg: 'rgba(16, 185, 129, 0.08)',
    border: 'rgba(16, 185, 129, 0.2)',
    formFields: {
      showOrderNo: true,
      showDesignNo: true,
      showTransport: true,
      showBilty: true,
      showProcessName: false,
      partyLabel: 'Party Name',
      partyPlaceholder: 'e.g. Shree Radha Studio',
      quantityLabel: 'Quantity',
      unitOptions: ['pcs', 'pkg', 'parcel', 'kg', 'meter'],
      descriptionPlaceholder: 'e.g. 10 Silk fabric rolls, design D-456'
    }
  },
  accounts: {
    label: 'Accounts',
    dashboardTitle: 'Accounts & Finance Dashboard',
    incomingLabel: 'Challans Received Today',
    outgoingLabel: 'Challans Issued Today',
    pendingLabel: 'Pending Verification',
    description: 'Track financial documents and challan authorizations',
    color: '#3b82f6',
    glow: 'rgba(59, 130, 246, 0.25)',
    bg: 'rgba(59, 130, 246, 0.08)',
    border: 'rgba(59, 130, 246, 0.2)',
    formFields: {
      showOrderNo: false,
      showDesignNo: false,
      showTransport: false,
      showBilty: false,
      showProcessName: false,
      partyLabel: 'Party / Vendor Name',
      partyPlaceholder: 'e.g. CA Services Ltd',
      quantityLabel: 'No. of Documents/Bills',
      unitOptions: ['files', 'pages', 'envelopes'],
      descriptionPlaceholder: 'e.g. Invoices for April 2024, Vendor XYZ'
    }
  },
  production: {
    label: 'Production',
    dashboardTitle: 'Production Floor Dashboard',
    incomingLabel: 'Materials Received Today',
    outgoingLabel: 'Materials Dispatched Today',
    pendingLabel: 'Pending Clearances',
    description: 'Oversee raw material flow and production dispatch',
    color: '#f59e0b',
    glow: 'rgba(245, 158, 11, 0.25)',
    bg: 'rgba(245, 158, 11, 0.08)',
    border: 'rgba(245, 158, 11, 0.2)',
    formFields: {
      showOrderNo: true,
      showDesignNo: true,
      showTransport: false,
      showBilty: false,
      showProcessName: true,
      partyLabel: 'Karigar / Party Name',
      partyPlaceholder: 'e.g. Raju Karigar',
      quantityLabel: 'Quantity',
      unitOptions: ['pcs', 'kg', 'meter', 'rolls'],
      descriptionPlaceholder: 'e.g. 50 kg raw cotton yarn'
    }
  },
  dispatch: {
    label: 'Dispatch',
    dashboardTitle: 'Dispatch & Logistics Dashboard',
    incomingLabel: 'Consignments Received Today',
    outgoingLabel: 'Consignments Dispatched Today',
    pendingLabel: 'Awaiting Gate Pass',
    description: 'Manage outbound shipments and gate pass requests',
    color: '#8b5cf6',
    glow: 'rgba(139, 92, 246, 0.25)',
    bg: 'rgba(139, 92, 246, 0.08)',
    border: 'rgba(139, 92, 246, 0.2)',
    formFields: {
      showOrderNo: true,
      showDesignNo: false,
      showTransport: true,
      showBilty: true,
      showProcessName: false,
      partyLabel: 'Consignee Name',
      partyPlaceholder: 'e.g. Retailer XYZ',
      quantityLabel: 'Total Packages',
      unitOptions: ['pkg', 'parcel', 'boxes', 'pallets'],
      descriptionPlaceholder: 'e.g. Final finished garments for Order #123'
    }
  },
};

export const getStatusLabel = (status) => {
  switch (status) {
    case 'completed':     return 'Cleared';
    case 'rejected':      return 'On Hold';
    case 'dept_issued':   return 'Awaiting Guard';
    case 'guard_cleared': return 'Gate Pass Issued';
    case 'guard_held':    return 'Held by Guard';
    default:              return 'Pending';
  }
};

export const getStatusBadgeClass = (status) => {
  switch (status) {
    case 'completed':     return 'badge-in';
    case 'rejected':      return 'badge-out';
    case 'dept_issued':   return 'badge-dept';
    case 'guard_cleared': return 'badge-cleared';
    case 'guard_held':    return 'badge-out';
    default:              return 'badge-pending';
  }
};

export const getDeptLabel = (value) => {
  const found = DEPT_OPTIONS.find(d => d.value === value);
  return found ? found.label : (value || 'N/A');
};
