export interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  cupboard: number;
  shelf: string;
  category: string;
  serialNumber?: string;
  modelNumber?: string;
  imei?: string;
  adapter?: string;
  cable?: string;
  sim?: string;
  box?: string;
  remark?: string;
  working?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface InventoryRequest {
  id: string;
  itemId?: string;
  itemName: string;
  userId: string;
  userName: string;
  userEmail: string;
  type: 'take' | 'return' | 'request';
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  quantity: number;
  createdAt: string;
  updatedAt: string;
  note?: string;
}

export interface InventoryData {
  items: InventoryItem[];
  requests: InventoryRequest[];
  lastAction: string;
}

export const CUPBOARDS = [1, 2, 3, 4, 5];
export const SHELVES = ['A', 'B', 'C', 'D', 'E', 'F'];

export const CATEGORIES = [
  "Master",
  "Phones and Tablets",
  "TV",
  "Laptops",
  "Sensors",
  "VR",
  "Stands",
  "Printers",
  "Keyboard & Mouse",
  "Cables",
  "Scanners",
  "Monitors",
  "Lights",
  "Hardware",
  "Power Banks",
  "External Storage",
  "Stationery"
];

export function generateId(cupboard: number, shelf: string, items: InventoryItem[]): string {
  const prefix = `C${cupboard}-${shelf}-`;
  const existingInShelf = items
    .filter(item => item.id.startsWith(prefix))
    .map(item => {
      const parts = item.id.split('-');
      return parseInt(parts[parts.length - 1]);
    })
    .sort((a, b) => a - b);
  
  let nextNum = 1;
  if (existingInShelf.length > 0) {
    nextNum = existingInShelf[existingInShelf.length - 1] + 1;
  }
  
  return `${prefix}${nextNum.toString().padStart(3, '0')}`;
}
