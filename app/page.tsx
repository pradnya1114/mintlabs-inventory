'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Package, 
  Plus, 
  Search, 
  Trash2, 
  Edit3, 
  LayoutGrid, 
  AlertCircle, 
  Download, 
  LogOut,
  ChevronRight,
  ChevronDown,
  RefreshCcw,
  Box,
  Filter,
  Folder,
  FileText,
  LogIn,
  User
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { InventoryItem, InventoryData, CUPBOARDS, SHELVES, CATEGORIES, generateId } from '@/lib/inventory';
import { auth, db } from '@/firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  onSnapshot, 
  setDoc, 
  deleteDoc, 
  getDoc,
  getDocFromServer,
  query,
  orderBy,
  Timestamp,
  writeBatch
} from 'firebase/firestore';

// Error Handling Enums and Interfaces
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.error?.message || "{}");
        if (parsed.error) {
          errorMessage = `Database Error: ${parsed.error}`;
        }
      } catch (e) {
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-red-100">
            <div className="w-12 h-12 bg-red-100 text-red-600 rounded-xl flex items-center justify-center mb-4">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Application Error</h2>
            <p className="text-gray-600 text-sm mb-6">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-red-600 text-white p-3 rounded-xl font-bold hover:bg-red-700 transition-all"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function InventoryPageWrapper() {
  return (
    <ErrorBoundary>
      <InventoryPage />
    </ErrorBoundary>
  );
}

function InventoryPage() {
  const [data, setData] = useState<InventoryData>({ items: [], lastAction: 'Initializing...' });
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [status, setStatus] = useState('System Ready');
  const [exports, setExports] = useState<string[]>([]);
  const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);
  
  // Form States
  const [newItem, setNewItem] = useState({ 
    name: '', 
    quantity: 1, 
    cupboard: 1, 
    shelf: 'A', 
    category: CATEGORIES[0],
    serialNumber: '',
    modelNumber: ''
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Master');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<InventoryItem | null>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
      if (u) {
        setIsAdmin(u.email === 'pradnya@mintlabs.in');
        setStatus(`Logged in as ${u.displayName || u.email}`);
      } else {
        setIsAdmin(false);
        setStatus('Please log in');
      }
    });
    return () => unsubscribe();
  }, []);

  // Firestore Connection Test
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
          setStatus('Database Offline - Check Config');
        }
      }
    }
    testConnection();
  }, []);

  // Firestore Listeners
  useEffect(() => {
    if (!isAuthReady || !user) return;

    const inventoryPath = 'inventory';
    const metadataPath = 'metadata';

    const unsubscribeInventory = onSnapshot(collection(db, inventoryPath), (snapshot) => {
      const items = snapshot.docs.map(doc => doc.data() as InventoryItem);
      setData(prev => ({ ...prev, items }));
      setStatus('Data Synchronized');
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, inventoryPath);
    });

    const unsubscribeMetadata = onSnapshot(doc(db, metadataPath, 'app'), (docSnap) => {
      if (docSnap.exists()) {
        const metadata = docSnap.data();
        setData(prev => ({ ...prev, lastAction: metadata.lastAction || 'No recent actions' }));
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `${metadataPath}/app`);
    });

    return () => {
      unsubscribeInventory();
      unsubscribeMetadata();
    };
  }, [isAuthReady, user]);

  const fetchExports = useCallback(async () => {
    try {
      const res = await fetch('/api/export-csv/list');
      const data = await res.json();
      setExports(data.exports || []);
    } catch (err) {
      console.error('Failed to fetch exports:', err);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      void (async () => {
        await fetchExports();
      })();
    }
  }, [isAdmin, fetchExports]);

  const handleLogin = useCallback(async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login failed:', error);
      setStatus('Login Failed');
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  }, []);

  const updateLastAction = useCallback(async (action: string) => {
    const path = 'metadata/app';
    try {
      await setDoc(doc(db, 'metadata', 'app'), {
        lastAction: action,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }, []);

  const handleAddItem = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItem.name || newItem.quantity < 1) return;

    const id = generateId(newItem.cupboard, newItem.shelf, data.items);
    const item: InventoryItem = { 
      ...newItem, 
      id,
      updatedAt: new Date().toISOString(),
      updatedBy: user?.uid
    };
    
    const path = `inventory/${id}`;
    try {
      await setDoc(doc(db, 'inventory', id), item);
      await updateLastAction(`Added item: ${item.name} (${id})`);
      setNewItem({ 
        name: '', 
        quantity: 1, 
        cupboard: 1, 
        shelf: 'A', 
        category: selectedCategory === 'Master' ? CATEGORIES[1] : selectedCategory,
        serialNumber: '',
        modelNumber: ''
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }, [newItem, data.items, user?.uid, selectedCategory, updateLastAction]);

  const handleDeleteItem = useCallback((id: string) => {
    setConfirmModal({
      message: `Are you sure you want to delete item ${id}?`,
      onConfirm: async () => {
        const path = `inventory/${id}`;
        try {
          await deleteDoc(doc(db, 'inventory', id));
          await updateLastAction(`Deleted item: ${id}`);
          setConfirmModal(null);
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, path);
        }
      }
    });
  }, [updateLastAction]);

  const handleEditStart = useCallback((item: InventoryItem) => {
    setEditingId(item.id);
    setEditForm({ ...item });
  }, []);

  const handleEditSave = useCallback(async () => {
    if (!editForm) return;
    const path = `inventory/${editForm.id}`;
    try {
      const updatedItem = {
        ...editForm,
        updatedAt: new Date().toISOString(),
        updatedBy: user?.uid
      };
      await setDoc(doc(db, 'inventory', editForm.id), updatedItem);
      await updateLastAction(`Updated item: ${editForm.name} (${editForm.id})`);
      setEditingId(null);
      setEditForm(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }, [editForm, user, updateLastAction]);

  const handleClearAll = useCallback(() => {
    setConfirmModal({
      message: 'CRITICAL: Are you sure you want to clear ALL inventory? This cannot be undone.',
      onConfirm: async () => {
        const batch = writeBatch(db);
        data.items.forEach(item => {
          batch.delete(doc(db, 'inventory', item.id));
        });
        try {
          await batch.commit();
          await updateLastAction('Inventory Cleared');
          setConfirmModal(null);
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, 'inventory (batch delete)');
        }
      }
    });
  }, [data.items, updateLastAction]);

  const exportToCSV = useCallback(async () => {
    const headers = ['ID', 'Name', 'Quantity', 'Cupboard', 'Shelf', 'Category', 'Serial Number', 'Model Number'];
    const rows = data.items.map(i => [
      i.id, 
      i.name, 
      i.quantity, 
      i.cupboard, 
      i.shelf, 
      i.category, 
      i.serialNumber || '', 
      i.modelNumber || ''
    ]);
    const csvContent = [headers, ...rows].map(e => e.map(val => `"${val}"`).join(",")).join("\n");
    
    // Save to browser (Download)
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    const fileName = `inventory_export_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    link.setAttribute("href", url);
    link.setAttribute("download", fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Save to server folder
    try {
      const response = await fetch('/api/export-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvContent, fileName })
      });
      const result = await response.json();
      if (result.success) {
        setStatus(`Inventory exported and saved to server: ${fileName}`);
        fetchExports();
      } else {
        setStatus('Exported to browser, but failed to save on server');
      }
    } catch (error) {
      console.error('Server export failed:', error);
      setStatus('Exported to browser, but server save failed');
    }
  }, [data.items, fetchExports]);

  const filteredItems = useMemo(() => {
    return data.items.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           item.id.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategory === 'Master' || item.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [data.items, searchQuery, selectedCategory]);

  const stats = useMemo(() => {
    const totalItems = data.items.length;
    const totalQuantity = data.items.reduce((acc, item) => acc + item.quantity, 0);
    const perCupboard = CUPBOARDS.reduce((acc, c) => {
      acc[c] = data.items.filter(i => i.cupboard === c).length;
      return acc;
    }, {} as Record<number, number>);
    const perCategory = CATEGORIES.reduce((acc, cat) => {
      acc[cat] = data.items.filter(i => i.category === cat).length;
      return acc;
    }, {} as Record<string, number>);
    return { totalItems, totalQuantity, perCupboard, perCategory };
  }, [data.items]);

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-[#F5F5F4] flex items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-4">
          <RefreshCcw className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Initializing System...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F5F5F4] flex items-center justify-center p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white border border-black/10 p-10 w-full max-w-md shadow-2xl rounded-2xl"
        >
          <div className="flex flex-col items-center mb-10 text-center">
            <div className="w-16 h-16 bg-blue-600 text-white rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-blue-200">
              <Box className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Inventory Control</h1>
            <p className="text-sm text-gray-500 mt-1">Professional Asset Management System</p>
          </div>

          <div className="space-y-6">
            <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
              <p className="text-xs text-blue-700 leading-relaxed text-center">
                Welcome to the Mint Labs Inventory System. Please sign in with your corporate account to access the dashboard.
              </p>
            </div>

            <button 
              onClick={handleLogin}
              className="w-full bg-white border border-gray-200 text-gray-700 p-4 rounded-xl font-bold flex items-center justify-center gap-3 hover:bg-gray-50 transition-all shadow-sm active:scale-[0.98]"
            >
              <LogIn className="w-5 h-5 text-blue-600" />
              Sign in with Google
            </button>
          </div>

          <div className="mt-8 flex items-center justify-center gap-2">
            <div className="h-px bg-gray-100 flex-1"></div>
            <span className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Authorized Only</span>
            <div className="h-px bg-gray-100 flex-1"></div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F4] text-[#1A1A1A] font-sans flex flex-col">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-100 p-4 px-8 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 text-white rounded-lg flex items-center justify-center shadow-md">
            <Box className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Inventory Control</h1>
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest leading-none">System Active</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={exportToCSV}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all active:scale-95"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <div className="h-6 w-px bg-gray-200 mx-1"></div>
          <button 
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-xs font-bold hover:bg-black transition-all active:scale-95 shadow-md"
          >
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </header>

      {/* Category Navigation Bar */}
      <nav className="bg-white border-b border-gray-100 overflow-x-auto whitespace-nowrap sticky top-[73px] z-20 no-scrollbar px-8">
        <div className="flex items-center gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-5 py-4 text-[11px] uppercase font-bold transition-all relative group ${
                selectedCategory === cat 
                  ? 'text-blue-600' 
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {cat}
              {selectedCategory === cat && (
                <motion.div 
                  layoutId="activeTab"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"
                />
              )}
            </button>
          ))}
        </div>
      </nav>

      <main className="flex-1 p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-[1800px] mx-auto w-full">
        {/* Left Panel: Controls */}
        <div className="lg:col-span-4 space-y-8">
          {/* Add Item Panel */}
          {isAdmin && (
            <section className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center">
                  <Plus className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-bold text-gray-900 uppercase tracking-tight">Register Asset</h2>
              </div>
              <form onSubmit={handleAddItem} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Item Name</label>
                    <input 
                      type="text" 
                      required
                      className="w-full border border-gray-100 rounded-xl p-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all bg-gray-50/50"
                      value={newItem.name}
                      onChange={e => setNewItem({...newItem, name: e.target.value})}
                      placeholder="e.g. Dell Monitor P2419H"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Quantity</label>
                    <input 
                      type="number" 
                      min="1"
                      required
                      className="w-full border border-gray-100 rounded-xl p-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all bg-gray-50/50"
                      value={newItem.quantity}
                      onChange={e => setNewItem({...newItem, quantity: parseInt(e.target.value) || 0})}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Category</label>
                    <select 
                      className="w-full border border-gray-100 rounded-xl p-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all bg-gray-50/50"
                      value={newItem.category}
                      onChange={e => setNewItem({...newItem, category: e.target.value})}
                    >
                      {CATEGORIES.filter(c => c !== 'Master').map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Cupboard</label>
                    <select 
                      className="w-full border border-gray-100 rounded-xl p-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all bg-gray-50/50"
                      value={newItem.cupboard}
                      onChange={e => setNewItem({...newItem, cupboard: parseInt(e.target.value)})}
                    >
                      {CUPBOARDS.map(c => <option key={c} value={c}>Cupboard {c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Shelf / Board</label>
                    <select 
                      className="w-full border border-gray-100 rounded-xl p-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all bg-gray-50/50"
                      value={newItem.shelf}
                      onChange={e => setNewItem({...newItem, shelf: e.target.value})}
                    >
                      {SHELVES.map(s => <option key={s} value={s}>Shelf {s}</option>)}
                    </select>
                  </div>
                  <div className="col-span-1">
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Serial Number</label>
                    <input 
                      type="text" 
                      className="w-full border border-gray-100 rounded-xl p-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all bg-gray-50/50"
                      value={newItem.serialNumber}
                      onChange={e => setNewItem({...newItem, serialNumber: e.target.value})}
                      placeholder="SN-XXXX"
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Model Number</label>
                    <input 
                      type="text" 
                      className="w-full border border-gray-100 rounded-xl p-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all bg-gray-50/50"
                      value={newItem.modelNumber}
                      onChange={e => setNewItem({...newItem, modelNumber: e.target.value})}
                      placeholder="MD-XXXX"
                    />
                  </div>
                </div>
                <button 
                  type="submit"
                  className="w-full bg-blue-600 text-white p-4 rounded-xl font-bold text-sm uppercase tracking-wider hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 active:scale-[0.98] mt-2"
                >
                  Add to Inventory
                </button>
              </form>
            </section>
          )}

          {/* Search & Stats Panel */}
          <section className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 bg-gray-50 text-gray-600 rounded-lg flex items-center justify-center">
                <Search className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-tight">Control Center</h2>
            </div>
            <div className="space-y-6">
              <div className="relative">
                <input 
                  type="text" 
                  placeholder="Search assets..."
                  className="w-full border border-gray-100 rounded-xl p-3.5 pl-11 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all bg-gray-50/50"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                <Search className="w-4 h-4 absolute left-4 top-4 text-gray-400" />
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 bg-gray-900 rounded-xl p-4 text-white flex justify-between items-center shadow-lg">
                  <div>
                    <p className="text-[9px] font-bold uppercase text-gray-400 tracking-widest mb-1">Total Assets</p>
                    <p className="text-2xl font-bold leading-none">{stats.totalItems}</p>
                  </div>
                  <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center">
                    <LayoutGrid className="w-5 h-5 text-blue-400" />
                  </div>
                </div>
                <div className="col-span-2 bg-white border border-gray-100 rounded-xl p-4 flex justify-between items-center">
                  <div>
                    <p className="text-[9px] font-bold uppercase text-gray-400 tracking-widest mb-1">Total Units</p>
                    <p className="text-2xl font-bold leading-none text-gray-900">{stats.totalQuantity}</p>
                  </div>
                  <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                    <RefreshCcw className="w-5 h-5 text-blue-600" />
                  </div>
                </div>
                {CUPBOARDS.map(c => (
                  <div key={c} className="bg-gray-50/50 border border-gray-100 rounded-xl p-3 flex justify-between items-center">
                    <span className="text-[10px] font-bold text-gray-500 uppercase">C{c}</span>
                    <span className="text-xs font-bold text-gray-900">{stats.perCupboard[c]}</span>
                  </div>
                ))}
              </div>

              {isAdmin && (
                <div className="space-y-3 pt-2">
                  <button 
                    onClick={exportToCSV}
                    className="w-full bg-white border border-gray-200 text-gray-700 p-3.5 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-gray-50 transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
                  >
                    <Download className="w-4 h-4" /> Download Master CSV
                  </button>
                  <button 
                    onClick={handleClearAll}
                    className="w-full border border-red-100 text-red-500 p-3.5 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-red-50 transition-all active:scale-[0.98]"
                  >
                    Clear All Inventory
                  </button>
                </div>
              )}

              {isAdmin && exports.length > 0 && (
                <div className="pt-6 border-t border-gray-100">
                  <div className="flex items-center gap-2 mb-4">
                    <Folder className="w-4 h-4 text-gray-400" />
                    <h3 className="text-[10px] font-bold uppercase text-gray-400 tracking-widest">Recent Server Exports</h3>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto no-scrollbar">
                    {exports.map((file) => (
                      <div key={file} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg hover:bg-gray-100 transition-all group">
                        <div className="flex items-center gap-2 overflow-hidden">
                          <FileText className="w-3 h-3 text-blue-500 flex-shrink-0" />
                          <span className="text-[10px] text-gray-600 font-medium truncate">{file}</span>
                        </div>
                        <a 
                          href={`/api/export-csv/download?file=${file}`}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all active:scale-90"
                          title="Download from server"
                        >
                          <Download className="w-3 h-3" />
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Right Panel: Inventory Display */}
        <div className="lg:col-span-8">
          <section className="bg-white rounded-2xl border border-gray-100 h-full flex flex-col shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-white">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center">
                  <Filter className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-bold text-gray-900 uppercase tracking-tight">
                  {selectedCategory === 'Master' ? 'Master Ledger' : `${selectedCategory} Ledger`}
                </h2>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-[10px] font-bold uppercase text-gray-400 tracking-widest">
                  {filteredItems.length} Records Found
                </span>
                {selectedCategory === 'Master' && (
                  <div className="px-2.5 py-1 bg-blue-50 text-blue-600 text-[9px] font-bold uppercase rounded-full tracking-wider">
                    Global View
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-auto no-scrollbar">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-white/95 backdrop-blur-sm z-10">
                  <tr className="border-b border-gray-100">
                    <th className="text-left p-5 text-[10px] uppercase font-bold text-gray-400 tracking-widest w-32">ID</th>
                    <th className="text-left p-5 text-[10px] uppercase font-bold text-gray-400 tracking-widest">Asset Description</th>
                    <th className="text-center p-5 text-[10px] uppercase font-bold text-gray-400 tracking-widest w-24">Qty</th>
                    <th className="text-center p-5 text-[10px] uppercase font-bold text-gray-400 tracking-widest w-24">Loc</th>
                    {isAdmin && <th className="text-center p-5 text-[10px] uppercase font-bold text-gray-400 tracking-widest w-32">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  <AnimatePresence mode="popLayout">
                    {filteredItems.map((item) => (
                      <motion.tr 
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        key={item.id} 
                        className="group hover:bg-blue-50/30 transition-colors"
                      >
                        <td className="p-5 text-xs font-mono text-gray-400">
                          <span className="bg-gray-100 px-2 py-1 rounded text-gray-600">{item.id}</span>
                        </td>
                        <td className="p-5 text-xs">
                          {editingId === item.id ? (
                            <div className="space-y-3 p-2 bg-gray-50 rounded-xl border border-gray-100">
                              <input 
                                className="w-full border border-gray-200 rounded-lg p-2 bg-white text-xs outline-none focus:border-blue-500 transition-all"
                                placeholder="Item Name"
                                value={editForm?.name || ''}
                                onChange={e => setEditForm(prev => prev ? {...prev, name: e.target.value} : null)}
                              />
                              <div className="grid grid-cols-2 gap-2">
                                <input 
                                  className="border border-gray-200 rounded-lg p-2 bg-white text-[10px] uppercase outline-none focus:border-blue-500 transition-all"
                                  placeholder="Serial #"
                                  value={editForm?.serialNumber || ''}
                                  onChange={e => setEditForm(prev => prev ? {...prev, serialNumber: e.target.value} : null)}
                                />
                                <input 
                                  className="border border-gray-200 rounded-lg p-2 bg-white text-[10px] uppercase outline-none focus:border-blue-500 transition-all"
                                  placeholder="Model #"
                                  value={editForm?.modelNumber || ''}
                                  onChange={e => setEditForm(prev => prev ? {...prev, modelNumber: e.target.value} : null)}
                                />
                              </div>
                              <select 
                                className="w-full border border-gray-200 rounded-lg p-2 bg-white text-[10px] outline-none focus:border-blue-500 transition-all"
                                value={editForm?.category || ''}
                                onChange={e => setEditForm(prev => prev ? {...prev, category: e.target.value} : null)}
                              >
                                {CATEGORIES.filter(c => c !== 'Master').map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </div>
                          ) : (
                            <div className="flex flex-col">
                              <span className="text-sm font-bold text-gray-900 tracking-tight">{item.name}</span>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 text-[9px] font-bold uppercase rounded leading-none">{item.category}</span>
                                {item.serialNumber && (
                                  <span className="text-[9px] text-gray-400 flex items-center gap-1">
                                    <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                                    SN: <span className="font-mono">{item.serialNumber}</span>
                                  </span>
                                )}
                                {item.modelNumber && (
                                  <span className="text-[9px] text-gray-400 flex items-center gap-1">
                                    <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                                    MD: <span className="font-mono">{item.modelNumber}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="p-5 text-center">
                          {editingId === item.id ? (
                            <input 
                              type="number"
                              className="w-16 border border-gray-200 rounded-lg p-2 bg-white text-xs text-center outline-none focus:border-blue-500 transition-all"
                              value={editForm?.quantity || 0}
                              onChange={e => setEditForm(prev => prev ? {...prev, quantity: parseInt(e.target.value) || 0} : null)}
                            />
                          ) : (
                            <span className={`inline-flex items-center justify-center w-10 h-10 rounded-xl font-bold text-xs ${
                              item.quantity < 5 ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
                            }`}>
                              {item.quantity}
                            </span>
                          )}
                        </td>
                        <td className="p-5 text-center">
                          {editingId === item.id ? (
                            <div className="flex flex-col gap-1">
                              <select 
                                className="w-full border border-gray-200 rounded-lg p-1.5 bg-white text-[10px] outline-none focus:border-blue-500 transition-all"
                                value={editForm?.cupboard || 1}
                                onChange={e => setEditForm(prev => prev ? {...prev, cupboard: parseInt(e.target.value)} : null)}
                              >
                                {CUPBOARDS.map(c => <option key={c} value={c}>C{c}</option>)}
                              </select>
                              <select 
                                className="w-full border border-gray-200 rounded-lg p-1.5 bg-white text-[10px] outline-none focus:border-blue-500 transition-all"
                                value={editForm?.shelf || 'A'}
                                onChange={e => setEditForm(prev => prev ? {...prev, shelf: e.target.value} : null)}
                              >
                                {SHELVES.map(s => <option key={s} value={s}>S{s}</option>)}
                              </select>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center">
                              <span className="text-xs font-bold text-gray-900">C{item.cupboard}</span>
                              <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Shelf {item.shelf}</span>
                            </div>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="p-5">
                            <div className="flex items-center justify-center gap-2">
                              {editingId === item.id ? (
                                <button 
                                  onClick={handleEditSave}
                                  className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all shadow-md active:scale-90"
                                >
                                  <Plus className="w-4 h-4 rotate-45" />
                                </button>
                              ) : (
                                <>
                                  <button 
                                    onClick={() => handleEditStart(item)}
                                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all active:scale-90"
                                  >
                                    <Edit3 className="w-4 h-4" />
                                  </button>
                                  <button 
                                    onClick={() => handleDeleteItem(item.id)}
                                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all active:scale-90"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        )}
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
              {filteredItems.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                    <Search className="w-8 h-8 text-gray-200" />
                  </div>
                  <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">No matching records found</p>
                  <p className="text-xs text-gray-300 mt-1">Try adjusting your search or category filters</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Status Bar */}
      <footer className="bg-white border-t border-gray-100 p-3 px-8 flex items-center justify-between text-[10px] uppercase font-bold tracking-widest text-gray-400">
        <div className="flex items-center gap-8">
          <span className="flex items-center gap-2 text-gray-500">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.5)]"></span>
            {status}
          </span>
          <div className="h-3 w-px bg-gray-100"></div>
          <span className="flex items-center gap-2">
            <RefreshCcw className="w-3 h-3" />
            Total Units: <span className="text-gray-900">{stats.totalQuantity}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          Last Action: <span className="text-gray-600">{data.lastAction}</span>
        </div>
      </footer>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-2xl p-8 w-full max-w-sm shadow-2xl border border-gray-100"
            >
              <div className="w-12 h-12 bg-red-50 text-red-600 rounded-xl flex items-center justify-center mb-6">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Confirm Action</h3>
              <p className="text-sm text-gray-500 mb-8 leading-relaxed">{confirmModal.message}</p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setConfirmModal(null)}
                  className="flex-1 px-4 py-3 bg-gray-50 text-gray-600 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-gray-100 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmModal.onConfirm}
                  className="flex-1 px-4 py-3 bg-red-600 text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-red-700 transition-all shadow-lg shadow-red-100"
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style jsx global>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
