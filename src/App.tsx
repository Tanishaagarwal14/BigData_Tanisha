import React, { useState, useEffect, useMemo } from 'react';
import { db, auth, handleFirestoreError, OperationType } from './lib/firebase';
import { collection, onSnapshot, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { 
  AlertCircle, TrendingDown, Users, Search, Mail, Upload, 
  CheckCircle, LogOut, LayoutDashboard, BarChart3, List, Settings,
  Loader2, ChevronRight, Filter, Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { processCSV, CustomerData, ReviewData } from './services/customerService';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const COLORS = ['#10b981', '#f59e0b', '#ef4444']; // Positive, Neutral, Negative

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<CustomerData[]>([]);
  const [reviews, setReviews] = useState<ReviewData[]>([]);
  const [uploading, setUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'at-risk' | 'upload'>('overview');
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const customersUnsubscribe = onSnapshot(collection(db, 'customers'), (snapshot) => {
      const data = snapshot.docs.map(doc => doc.data() as CustomerData);
      setCustomers(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'customers');
    });

    const reviewsUnsubscribe = onSnapshot(collection(db, 'reviews'), (snapshot) => {
      const data = snapshot.docs.map(doc => doc.data() as ReviewData);
      setReviews(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'reviews');
    });

    return () => {
      customersUnsubscribe();
      reviewsUnsubscribe();
    };
  }, [user]);

  const handleLogin = async () => {
    setAuthError(null);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Login failed:", error);
      if (error.code === 'auth/network-request-failed') {
        setAuthError("Network request failed. This often happens when running inside an iFrame. Please try opening the app in a new tab.");
      } else {
        setAuthError(error.message || "Login failed. Please try again.");
      }
    }
  };

  const handleLogout = () => auth.signOut();

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      await processCSV(file);
      setActiveTab('overview');
    } catch (error) {
      console.error("Upload failed:", error);
      alert("Failed to process CSV. Check console for details.");
    } finally {
      setUploading(false);
    }
  };

  const atRiskCustomers = useMemo(() => {
    return customers.filter(c => c.isAtRisk);
  }, [customers]);

  const filteredAtRisk = useMemo(() => {
    return atRiskCustomers.filter(c => 
      c.email.toLowerCase().includes(searchTerm.toLowerCase()) || 
      c.id.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [atRiskCustomers, searchTerm]);

  const sentimentStats = useMemo(() => {
    const counts = { Positive: 0, Neutral: 0, Negative: 0 };
    reviews.forEach(r => {
      if (counts[r.sentiment] !== undefined) counts[r.sentiment]++;
    });
    return [
      { name: 'Positive', value: counts.Positive },
      { name: 'Neutral', value: counts.Neutral },
      { name: 'Negative', value: counts.Negative }
    ];
  }, [reviews]);

  const sentimentTrend = useMemo(() => {
    const trends: Record<string, { date: string; Positive: number; Neutral: number; Negative: number }> = {};
    reviews.forEach(r => {
      const date = new Date(r.date).toLocaleDateString();
      if (!trends[date]) trends[date] = { date, Positive: 0, Neutral: 0, Negative: 0 };
      trends[date][r.sentiment]++;
    });
    return Object.values(trends).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [reviews]);

  const downloadPDFReport = () => {
    const doc = new jsPDF();
    
    // Add Title
    doc.setFontSize(20);
    doc.text('At-Risk Customers Report', 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 30);
    doc.text(`Total At-Risk Customers: ${atRiskCustomers.length}`, 14, 36);

    // Prepare table data
    const tableData = filteredAtRisk.map(c => [
      c.email,
      `${c.riskScore}%`,
      new Date(c.lastPurchaseDate).toLocaleDateString(),
      c.lastReviewSentiment || 'N/A',
      c.secondLastReviewSentiment || 'N/A'
    ]);

    autoTable(doc, {
      startY: 45,
      head: [['Email', 'Risk Score', 'Last Purchase', 'Last Sentiment', '2nd Last Sentiment']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [249, 115, 22] }, // Orange-500
      styles: { fontSize: 9 }
    });

    doc.save(`churn-risk-report-${new Date().toISOString().split('T')[0]}.pdf`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tighter text-white">ChurnGuard AI</h1>
            <p className="text-zinc-400">E-commerce Sentiment & Churn Dashboard</p>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800 p-8 rounded-2xl space-y-6">
            <p className="text-sm text-zinc-400">Sign in to access your customer insights and risk analysis.</p>
            
            {authError && (
              <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-xl text-left space-y-3">
                <p className="text-xs text-rose-400 leading-relaxed">{authError}</p>
                <button 
                  onClick={() => window.open(window.location.href, '_blank')}
                  className="text-xs font-bold text-white underline underline-offset-4 hover:text-rose-300 transition-colors"
                >
                  Open in New Tab
                </button>
              </div>
            )}

            <button 
              onClick={handleLogin}
              className="w-full bg-white text-black font-semibold py-3 px-4 rounded-xl hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2"
            >
              <img src="https://www.google.com/favicon.ico" className="w-4 h-4" alt="Google" />
              Sign in with Google
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-zinc-800 flex flex-col hidden md:flex">
        <div className="p-6">
          <h2 className="text-xl font-bold tracking-tighter text-white flex items-center gap-2">
            <TrendingDown className="text-orange-500 w-6 h-6" />
            ChurnGuard
          </h2>
        </div>
        <nav className="flex-1 px-4 space-y-2">
          <SidebarItem 
            icon={<LayoutDashboard size={20} />} 
            label="Overview" 
            active={activeTab === 'overview'} 
            onClick={() => setActiveTab('overview')} 
          />
          <SidebarItem 
            icon={<AlertCircle size={20} />} 
            label="At-Risk Customers" 
            active={activeTab === 'at-risk'} 
            onClick={() => setActiveTab('at-risk')} 
            count={atRiskCustomers.length}
          />
          <SidebarItem 
            icon={<Upload size={20} />} 
            label="Upload Data" 
            active={activeTab === 'upload'} 
            onClick={() => setActiveTab('upload')} 
          />
        </nav>
        <div className="p-4 border-t border-zinc-800">
          <div className="flex items-center gap-3 px-2 py-3">
            <img src={user.photoURL || ''} className="w-8 h-8 rounded-full" alt={user.displayName || ''} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.displayName}</p>
              <p className="text-xs text-zinc-500 truncate">{user.email}</p>
            </div>
            <button onClick={handleLogout} className="text-zinc-500 hover:text-white transition-colors">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <header className="h-16 border-bottom border-zinc-800 flex items-center justify-between px-8 md:hidden">
           <h2 className="text-xl font-bold tracking-tighter text-white flex items-center gap-2">
            <TrendingDown className="text-orange-500 w-6 h-6" />
            ChurnGuard
          </h2>
          <button onClick={handleLogout} className="text-zinc-500 hover:text-white transition-colors">
            <LogOut size={18} />
          </button>
        </header>

        <div className="p-8 max-w-7xl mx-auto space-y-8">
          <AnimatePresence mode="wait">
            {activeTab === 'overview' && (
              <motion.div 
                key="overview"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h1 className="text-3xl font-bold tracking-tight">Dashboard Overview</h1>
                    <p className="text-zinc-400">Real-time sentiment and churn risk analysis.</p>
                  </div>
                  <div className="bg-orange-500/10 border border-orange-500/20 px-4 py-2 rounded-xl flex items-center gap-3">
                    <div className="w-10 h-10 bg-orange-500 rounded-full flex items-center justify-center text-black font-bold text-xl">
                      {atRiskCustomers.length}
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-orange-500">Churn Alert</p>
                      <p className="text-sm text-zinc-300">Customers at high risk today</p>
                    </div>
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <StatCard 
                    title="Total Customers" 
                    value={customers.length} 
                    icon={<Users className="text-blue-500" />} 
                    trend="+12% from last month"
                  />
                  <StatCard 
                    title="Avg. Risk Score" 
                    value={customers.length ? Math.round(customers.reduce((acc, c) => acc + c.riskScore, 0) / customers.length) : 0} 
                    icon={<TrendingDown className="text-orange-500" />} 
                    trend="Based on recent activity"
                  />
                  <StatCard 
                    title="Total Reviews" 
                    value={reviews.length} 
                    icon={<BarChart3 className="text-emerald-500" />} 
                    trend="Analyzed by Gemini AI"
                  />
                </div>

                {/* Charts Section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-2xl space-y-6">
                    <h3 className="text-lg font-semibold">Sentiment Trends</h3>
                    <div className="h-[300px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={sentimentTrend}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                          <XAxis dataKey="date" stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} />
                          <YAxis stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                            itemStyle={{ fontSize: '12px' }}
                          />
                          <Legend iconType="circle" />
                          <Bar dataKey="Positive" fill="#10b981" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="Neutral" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="Negative" fill="#ef4444" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-2xl space-y-6">
                    <h3 className="text-lg font-semibold">Sentiment Distribution</h3>
                    <div className="h-[300px] w-full flex items-center justify-center">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={sentimentStats}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {sentimentStats.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                          />
                          <Legend verticalAlign="bottom" height={36}/>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'at-risk' && (
              <motion.div 
                key="at-risk"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h1 className="text-3xl font-bold tracking-tight">At-Risk Customers</h1>
                    <p className="text-zinc-400">High priority retention targets.</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={downloadPDFReport}
                      className="bg-zinc-800 text-zinc-100 border border-zinc-700 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-zinc-700 transition-colors flex items-center gap-2"
                    >
                      <Download size={16} />
                      Download Report
                    </button>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 w-4 h-4" />
                      <input 
                        type="text" 
                        placeholder="Search email or ID..." 
                        className="bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50 w-full md:w-64"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-zinc-800 bg-zinc-900/80">
                          <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">Customer</th>
                          <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">Risk Score</th>
                          <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">Last Purchase</th>
                          <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">Last Review</th>
                          <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800">
                        {filteredAtRisk.map((customer) => (
                          <tr key={customer.id} className="hover:bg-zinc-800/30 transition-colors">
                            <td className="px-6 py-4">
                              <div className="flex flex-col">
                                <span className="font-medium text-white">{customer.email}</span>
                                <span className="text-xs text-zinc-500">ID: {customer.id}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <div className="w-12 bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                                  <div 
                                    className="bg-orange-500 h-full" 
                                    style={{ width: `${customer.riskScore}%` }}
                                  />
                                </div>
                                <span className="text-sm font-semibold">{customer.riskScore}%</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-sm text-zinc-400">
                              {new Date(customer.lastPurchaseDate).toLocaleDateString()}
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <SentimentBadge sentiment={customer.lastReviewSentiment} />
                                <SentimentBadge sentiment={customer.secondLastReviewSentiment} />
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <button className="bg-zinc-100 text-black text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-white transition-colors flex items-center gap-2">
                                <Mail size={14} />
                                Send Email
                              </button>
                            </td>
                          </tr>
                        ))}
                        {filteredAtRisk.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-6 py-12 text-center text-zinc-500">
                              No at-risk customers found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'upload' && (
              <motion.div 
                key="upload"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-2xl mx-auto space-y-8"
              >
                <div className="text-center space-y-2">
                  <h1 className="text-3xl font-bold tracking-tight">Upload Customer Data</h1>
                  <p className="text-zinc-400">Upload a CSV file to analyze sentiment and churn risk.</p>
                </div>

                <div className="bg-zinc-900/50 border-2 border-dashed border-zinc-800 rounded-3xl p-12 text-center space-y-6">
                  <div className="w-16 h-16 bg-zinc-800 rounded-2xl flex items-center justify-center mx-auto">
                    <Upload className="text-zinc-400" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-lg font-medium">Drag and drop your CSV file here</p>
                    <p className="text-sm text-zinc-500">Or click to browse from your computer</p>
                  </div>
                  <input 
                    type="file" 
                    accept=".csv" 
                    onChange={handleFileUpload}
                    className="hidden" 
                    id="csv-upload"
                    disabled={uploading}
                  />
                  <label 
                    htmlFor="csv-upload"
                    className={cn(
                      "inline-flex items-center gap-2 bg-white text-black font-bold py-3 px-8 rounded-xl cursor-pointer hover:bg-zinc-200 transition-colors",
                      uploading && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="animate-spin" size={20} />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Upload size={20} />
                        Select File
                      </>
                    )}
                  </label>
                  <div className="pt-4 text-xs text-zinc-500 space-y-1">
                    <p>Required columns: customerId, email, reviewText, purchaseDate, reviewDate</p>
                    <p>Dates should be in ISO format (YYYY-MM-DD)</p>
                  </div>
                </div>

                <div className="bg-zinc-900/30 border border-zinc-800 p-6 rounded-2xl space-y-4">
                  <h4 className="font-semibold flex items-center gap-2">
                    <Settings size={18} className="text-zinc-400" />
                    How it works
                  </h4>
                  <ul className="text-sm text-zinc-400 space-y-3">
                    <li className="flex gap-3">
                      <span className="w-5 h-5 bg-zinc-800 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0">1</span>
                      Gemini AI analyzes each review text for sentiment (Positive, Neutral, Negative).
                    </li>
                    <li className="flex gap-3">
                      <span className="w-5 h-5 bg-zinc-800 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0">2</span>
                      Churn risk is calculated based on purchase frequency and recent sentiment trends.
                    </li>
                    <li className="flex gap-3">
                      <span className="w-5 h-5 bg-zinc-800 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0">3</span>
                      High-risk customers are flagged for immediate retention actions.
                    </li>
                  </ul>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function SidebarItem({ icon, label, active, onClick, count }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void, count?: number }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group",
        active 
          ? "bg-orange-500/10 text-orange-500 border border-orange-500/20" 
          : "text-zinc-400 hover:text-white hover:bg-zinc-900"
      )}
    >
      <span className={cn(active ? "text-orange-500" : "text-zinc-500 group-hover:text-zinc-300")}>
        {icon}
      </span>
      <span className="flex-1 text-left font-medium">{label}</span>
      {count !== undefined && count > 0 && (
        <span className={cn(
          "text-[10px] font-bold px-1.5 py-0.5 rounded-md",
          active ? "bg-orange-500 text-black" : "bg-zinc-800 text-zinc-400"
        )}>
          {count}
        </span>
      )}
    </button>
  );
}

function StatCard({ title, value, icon, trend }: { title: string, value: string | number, icon: React.ReactNode, trend: string }) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-2xl space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-zinc-400 text-sm font-medium">{title}</span>
        <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center">
          {icon}
        </div>
      </div>
      <div className="space-y-1">
        <h3 className="text-3xl font-bold">{value}</h3>
        <p className="text-xs text-zinc-500">{trend}</p>
      </div>
    </div>
  );
}

function SentimentBadge({ sentiment }: { sentiment?: string }) {
  if (!sentiment) return null;
  
  const colors = {
    Positive: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    Neutral: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    Negative: "bg-rose-500/10 text-rose-500 border-rose-500/20"
  };

  return (
    <span className={cn(
      "text-[10px] font-bold px-2 py-0.5 rounded-full border",
      colors[sentiment as keyof typeof colors] || "bg-zinc-800 text-zinc-400 border-zinc-700"
    )}>
      {sentiment}
    </span>
  );
}
