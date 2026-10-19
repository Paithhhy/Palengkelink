/* Sample data. In the real system each list below becomes a database table
   queried through the framework API (see the 11-table ERD). */
const DB = {
  vendors: [
    { id: 1, business: "Nena’s Fresh Veggies", owner: "Nena Santos",    contact: "0917-555-0101", status: "Active" },
    { id: 2, business: "Berto Meat Shop",      owner: "Berto Cruz",     contact: "0918-555-0102", status: "Active" },
    { id: 3, business: "Dagat Seafoods",       owner: "Lita Reyes",     contact: "0919-555-0103", status: "Active" },
    { id: 4, business: "Tindahan ni Mario",    owner: "Mario Dela Cruz", contact: "0920-555-0104", status: "Suspended" },
  ],
  suppliers: [
    { id: 1, name: "Benguet Farmers Coop",   contact: "0917-600-0001", address: "La Trinidad, Benguet", status: "Active" },
    { id: 2, name: "Cebu Meat Distributors", contact: "0918-600-0002", address: "Mandaue City",         status: "Active" },
    { id: 3, name: "Bantayan Fish Traders",  contact: "0919-600-0003", address: "Bantayan Island",      status: "Active" },
  ],
  stalls: [
    { no: "A-01", type: "Wet",  rent: 1500, status: "Occupied",    vendor: 1 },
    { no: "A-02", type: "Wet",  rent: 1500, status: "Occupied",    vendor: 3 },
    { no: "B-01", type: "Dry",  rent: 1000, status: "Occupied",    vendor: 1 },
    { no: "B-02", type: "Dry",  rent: 1000, status: "Vacant",      vendor: 0 },
    { no: "C-01", type: "Meat", rent: 2000, status: "Occupied",    vendor: 2 },
    { no: "C-02", type: "Meat", rent: 2000, status: "Maintenance", vendor: 0 },
    { no: "D-01", type: "Dry",  rent: 900,  status: "Occupied",    vendor: 4 },
    { no: "D-02", type: "Dry",  rent: 900,  status: "Vacant",      vendor: 0 },
  ],
  payments: [
    { id: 1, vendor: 1, stall: "A-01", month: "Oct 2026", amount: 1500, status: "Paid" },
    { id: 2, vendor: 1, stall: "B-01", month: "Oct 2026", amount: 1000, status: "Unpaid" },
    { id: 3, vendor: 2, stall: "C-01", month: "Oct 2026", amount: 2000, status: "Paid" },
    { id: 4, vendor: 3, stall: "A-02", month: "Oct 2026", amount: 1500, status: "Unpaid" },
    { id: 5, vendor: 4, stall: "D-01", month: "Oct 2026", amount: 900,  status: "Unpaid" },
    { id: 6, vendor: 1, stall: "A-01", month: "Sep 2026", amount: 1500, status: "Paid" },
  ],
  products: [   // VENDOR_PRODUCTS junction: vendor + product + supplier + price/stock
    { vendor: 1, name: "Kangkong",  category: "Vegetable", price: 12,  stock: 80, supplier: 1 },
    { vendor: 1, name: "Kamatis",   category: "Vegetable", price: 60,  stock: 45, supplier: 1 },
    { vendor: 1, name: "Sibuyas",   category: "Vegetable", price: 90,  stock: 60, supplier: 1 },
    { vendor: 2, name: "Pork Belly", category: "Meat",     price: 320, stock: 25, supplier: 2 },
    { vendor: 3, name: "Bangus",    category: "Fish",      price: 180, stock: 40, supplier: 3 },
  ],
  inspections: [
    { id: 1, stall: "A-01", date: "2026-10-12", type: "Sanitation", result: "Passed", inspector: "Insp. Ramos" },
    { id: 2, stall: "C-01", date: "2026-10-13", type: "Sanitation", result: "Failed", inspector: "Insp. Ramos" },
    { id: 3, stall: "A-02", date: "2026-10-14", type: "Compliance", result: "Passed", inspector: "Insp. Lim" },
  ],
  maintenance: [
    { id: 1, stall: "A-01", vendor: 1, issue: "Leaking roof above stall", status: "Open" },
    { id: 2, stall: "C-02", vendor: 2, issue: "Broken meat hook rail",    status: "In Progress" },
    { id: 3, stall: "B-01", vendor: 1, issue: "Faulty light fixture",     status: "Resolved" },
  ],
};
