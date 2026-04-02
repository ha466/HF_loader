import React, { useState } from 'react';
import { 
  Folder, FolderOpen, File, ChevronRight, ChevronDown, 
  Download, Loader2, Search, CheckSquare, Square, 
  AlertCircle, Github, Box, Info, Settings, Key, X 
} from 'lucide-react';

// Helper to encode paths properly for HTTP requests while preserving slashes
const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

const TreeNode = ({ node, level, selectedPaths, toggleSelection, fetchDirectory }) => {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  // A node is implicitly selected if any of its parent directories are explicitly selected
  const isImplicitlySelected = () => {
    const parts = node.path.split('/');
    let current = '';
    for (let i = 0; i < parts.length - 1; i++) {
      current += (i === 0 ? '' : '/') + parts[i];
      if (selectedPaths.has(current)) return true;
    }
    return false;
  };

  const implicit = isImplicitlySelected();
  const selected = selectedPaths.has(node.path) || implicit;

  const handleExpand = async () => {
    if (!expanded && node.type === 'directory' && node.children.length === 0) {
      setLoading(true);
      await fetchDirectory(node.path);
      setLoading(false);
    }
    setExpanded(!expanded);
  };

  return (
    <div className="flex flex-col w-full">
      <div 
        className={`flex items-center py-1.5 hover:bg-gray-800 rounded-lg px-2 transition-colors ${implicit ? 'opacity-50' : ''}`} 
        style={{ paddingLeft: `${level * 1.5 + 0.5}rem` }}
      >
        <button onClick={handleExpand} className="w-6 h-6 flex items-center justify-center shrink-0">
          {node.type === 'directory' ? (
            loading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" /> :
            expanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />
          ) : <span className="w-4 h-4" /> /* Empty spacer for alignment */}
        </button>

        <button 
          onClick={() => !implicit && toggleSelection(node.path)}
          disabled={implicit}
          className="mr-2 shrink-0 flex items-center justify-center transition-transform active:scale-90"
        >
          {selected ? <CheckSquare className="w-4.5 h-4.5 text-yellow-500" /> : <Square className="w-4.5 h-4.5 text-gray-600" />}
        </button>

        {node.type === 'directory' ? (
          <Folder className="w-4.5 h-4.5 text-yellow-500 mr-2 shrink-0" />
        ) : (
          <File className="w-4.5 h-4.5 text-gray-500 mr-2 shrink-0" />
        )}

        <span 
          className="text-sm truncate select-none cursor-pointer flex-1 font-medium text-gray-200 hover:text-white transition-colors" 
          onClick={handleExpand}
        >
          {node.path.split('/').pop()}
        </span>

        {node.type === 'file' && (
          <span className="text-xs text-gray-500 shrink-0 ml-3">
            {(node.size / 1024).toFixed(1)} KB
          </span>
        )}
      </div>

      {expanded && node.children.length > 0 && (
        <div className="flex flex-col w-full">
          {node.children.map(child => (
            <TreeNode 
              key={child.path} 
              node={child} 
              level={level + 1} 
              selectedPaths={selectedPaths} 
              toggleSelection={toggleSelection}
              fetchDirectory={fetchDirectory}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default function App() {
  const [repoInput, setRepoInput] = useState('gradio/hello_world');
  const [repoType, setRepoType] = useState('spaces'); // 'spaces', 'models', 'datasets'
  const [treeData, setTreeData] = useState([]);
  const [selectedPaths, setSelectedPaths] = useState(new Set());
  
  // App Settings / Status
  const [hfToken, setHfToken] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [error, setError] = useState('');

  // Helper to attach authorization header if token exists
  const getHeaders = () => {
    return hfToken ? { 'Authorization': `Bearer ${hfToken}` } : {};
  };

  // Builds a nested hierarchical tree from a flat array of paths
  const buildTree = (flatData) => {
    const root = [];
    const map = {};

    flatData.forEach(item => {
      map[item.path] = { ...item, children: [] };
    });

    flatData.forEach(item => {
      const parts = item.path.split('/');
      if (parts.length === 1) {
        root.push(map[item.path]);
      } else {
        const parentPath = parts.slice(0, -1).join('/');
        if (map[parentPath]) {
          map[parentPath].children.push(map[item.path]);
        } else {
          root.push(map[item.path]); // Fallback if parent missing
        }
      }
    });

    const sortNodes = (nodes) => {
      nodes.sort((a, b) => {
        if (a.type === 'directory' && b.type === 'file') return -1;
        if (a.type === 'file' && b.type === 'directory') return 1;
        return a.path.localeCompare(b.path);
      });
      nodes.forEach(node => {
        if (node.children.length > 0) sortNodes(node.children);
      });
    };

    sortNodes(root);
    return root;
  };

  const loadRepository = async (e) => {
    if (e) e.preventDefault();
    if (!repoInput.trim()) return;

    setLoading(true);
    setError('');
    setTreeData([]);
    setSelectedPaths(new Set());

    try {
      // Smart URL parsing
      let currentType = repoType;
      let parsedId = repoInput.trim();
      
      if (parsedId.includes('huggingface.co')) {
        const urlObj = new URL(parsedId.startsWith('http') ? parsedId : `https://${parsedId}`);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        if (pathParts[0] === 'spaces' || pathParts[0] === 'datasets') {
          currentType = pathParts[0];
          parsedId = pathParts.slice(1, 3).join('/');
        } else {
          currentType = 'models';
          parsedId = pathParts.slice(0, 2).join('/');
        }
      }

      setRepoType(currentType);
      setRepoInput(parsedId);

      const url = `https://huggingface.co/api/${currentType}/${parsedId}/tree/main`;
      const res = await fetch(url, { headers: getHeaders() });
      
      if (!res.ok) {
        if (res.status === 401) throw new Error("Unauthorized. This repo might be private. Add your token in settings.");
        if (res.status === 404) throw new Error("Repository not found. It might be private or deleted.");
        throw new Error(`Failed to load repository: ${res.statusText}`);
      }

      const data = await res.json();
      setTreeData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchDirectory = async (path) => {
    try {
      const url = `https://huggingface.co/api/${repoType}/${repoInput}/tree/main/${encodePath(path)}`;
      const res = await fetch(url, { headers: getHeaders() });
      if (!res.ok) throw new Error("Failed to fetch directory contents.");
      const data = await res.json();

      setTreeData(prev => {
        const newTree = [...prev];
        data.forEach(item => {
          if (!newTree.some(x => x.path === item.path)) {
            newTree.push(item);
          }
        });
        return newTree;
      });
    } catch (e) {
      setError(`Error expanding folder: ${e.message}`);
    }
  };

  const toggleSelection = (path) => {
    setSelectedPaths(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) newSet.delete(path);
      else newSet.add(path);
      return newSet;
    });
  };

  const selectAll = () => {
    const roots = treeData.filter(x => !x.path.includes('/'));
    const newSel = new Set();
    roots.forEach(r => newSel.add(r.path));
    setSelectedPaths(newSel);
  };

  const clearSelection = () => setSelectedPaths(new Set());

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadProgress({ current: 0, total: 0, message: 'Resolving folder contents...' });
    setError('');

    try {
      const filesToDownload = new Set();
      const resolveQueue = Array.from(selectedPaths);
      let treeCache = [...treeData];

      // Recursively resolve checked directories into individual files
      while (resolveQueue.length > 0) {
        const currentPath = resolveQueue.shift();
        let item = treeCache.find((x) => x.path === currentPath);

        if (item && item.type === 'file') {
          filesToDownload.add(currentPath);
        } else if (item && item.type === 'directory') {
          setDownloadProgress({ current: 0, total: 0, message: `Resolving: ${currentPath}...` });
          
          const url = `https://huggingface.co/api/${repoType}/${repoInput}/tree/main/${encodePath(currentPath)}`;
          const res = await fetch(url, { headers: getHeaders() });
          if (!res.ok) throw new Error(`Failed to map directory ${currentPath}`);
          const children = await res.json();

          for (const child of children) {
            if (child.type === 'file') {
              filesToDownload.add(child.path);
            } else if (child.type === 'directory') {
              resolveQueue.push(child.path); // Add subdirectories to queue
            }
            if (!treeCache.some((x) => x.path === child.path)) {
              treeCache.push(child);
            }
          }
        }
      }

      setTreeData(treeCache); // Updates UI to reflect lazily loaded structure
      const fileList = Array.from(filesToDownload);
      
      if (fileList.length === 0) {
        throw new Error('No files to download in the selected paths.');
      }

      // Load JSZip dynamically to avoid bundler compilation errors
      let JSZipClass;
      try {
        const m = await import('https://esm.sh/jszip');
        JSZipClass = m.default;
      } catch(e) {
        throw new Error("Failed to load ZIP library. Please check your internet connection.");
      }
      
      const zip = new JSZipClass();
      let downloadedCount = 0;

      // Download files in chunks to avoid slamming network and getting a 429 Error
      const chunkSize = 5; 
      for (let i = 0; i < fileList.length; i += chunkSize) {
        const chunk = fileList.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (filePath) => {
          
          let downloadUrl;
          if (repoType === 'spaces') {
            downloadUrl = `https://huggingface.co/spaces/${repoInput}/resolve/main/${encodePath(filePath)}`;
          } else if (repoType === 'datasets') {
            downloadUrl = `https://huggingface.co/datasets/${repoInput}/resolve/main/${encodePath(filePath)}`;
          } else {
            downloadUrl = `https://huggingface.co/${repoInput}/resolve/main/${encodePath(filePath)}`;
          }

          const fileRes = await fetch(downloadUrl, { headers: getHeaders() });
          if (!fileRes.ok) throw new Error(`Failed to download ${filePath}`);
          
          const blob = await fileRes.blob();
          zip.file(filePath, blob);
          
          downloadedCount++;
          setDownloadProgress({
            current: downloadedCount,
            total: fileList.length,
            message: `Downloaded ${downloadedCount} of ${fileList.length} files...`
          });
        }));
      }

      setDownloadProgress({ current: fileList.length, total: fileList.length, message: 'Compressing archive...' });

      // Generate the ZIP blob
      const zipBlob = await zip.generateAsync({ type: 'blob' }, (meta) => {
        setDownloadProgress({
          current: fileList.length,
          total: fileList.length,
          message: `Compressing files... ${meta.percent.toFixed(0)}%`
        });
      });

      // Execute Download in Browser
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = repoInput.replace(/\//g, '_');
      a.download = `${safeName}_hf_files.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setDownloadProgress(null);
    } catch (err) {
      setError(err.message);
      setDownloadProgress(null);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="h-screen w-full bg-[#0b0f19] flex flex-col font-sans text-gray-200 overflow-hidden">
      
      {/* Top Navbar */}
      <header className="h-16 shrink-0 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-6 shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="bg-yellow-500 p-1.5 rounded-lg">
            <Box className="w-5 h-5 text-gray-950" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            HF Downloader <span className="text-yellow-500">Pro</span>
          </h1>
        </div>
        <button 
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors text-sm font-medium"
        >
          <Settings className="w-4 h-4 text-yellow-500" />
          Settings
          {hfToken && <span className="ml-1 flex h-2 w-2 rounded-full bg-green-500"></span>}
        </button>
      </header>

      <main className="flex-1 flex overflow-hidden">
        
        {/* Left Sidebar - Repo Selection & Tree */}
        <div className="w-full md:w-[400px] lg:w-[450px] flex flex-col bg-gray-900 border-r border-gray-800 shrink-0">
          
          {/* Input Form Area */}
          <div className="p-5 border-b border-gray-800 bg-gray-900 shadow-sm z-10">
            <form onSubmit={loadRepository} className="flex flex-col gap-3">
              <div className="flex gap-2">
                <select 
                  value={repoType} 
                  onChange={(e) => setRepoType(e.target.value)}
                  className="w-[110px] p-2.5 bg-gray-950 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-yellow-500 transition-colors"
                >
                  <option value="spaces">Spaces</option>
                  <option value="models">Models</option>
                  <option value="datasets">Datasets</option>
                </select>
                <input 
                  type="text" 
                  value={repoInput}
                  onChange={(e) => setRepoInput(e.target.value)}
                  placeholder="gradio/hello_world"
                  className="flex-1 min-w-0 p-2.5 bg-gray-950 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-yellow-500 transition-colors"
                />
              </div>
              <button 
                type="submit"
                disabled={loading}
                className="w-full bg-yellow-500 hover:bg-yellow-400 text-gray-950 py-2.5 rounded-lg flex items-center justify-center gap-2 font-bold transition-colors disabled:bg-gray-800 disabled:text-gray-600"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                {loading ? 'Fetching Repository...' : 'Load Repository'}
              </button>
            </form>
          </div>

          {/* Tree View Area */}
          <div className="flex-1 overflow-y-auto p-5 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-700 hover:[&::-webkit-scrollbar-thumb]:bg-gray-600 [&::-webkit-scrollbar-thumb]:rounded-full">
            {error && (
              <div className="mb-4 p-4 bg-red-950/40 text-red-400 rounded-xl flex items-start gap-3 border border-red-900/50">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-sm font-medium leading-relaxed">{error}</p>
              </div>
            )}
            
            {treeData.length > 0 ? (
              <div>
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-800">
                  <h2 className="font-semibold text-gray-300 flex items-center gap-2 text-sm uppercase tracking-wider">
                    <FolderOpen className="w-4 h-4 text-yellow-500" />
                    Explorer
                  </h2>
                  <div className="flex gap-4">
                    <button onClick={selectAll} className="text-xs text-yellow-500 hover:text-yellow-400 font-semibold transition-colors">Select All</button>
                    <button onClick={clearSelection} className="text-xs text-gray-500 hover:text-gray-300 font-semibold transition-colors">Clear</button>
                  </div>
                </div>
                <div className="pb-10">
                  {buildTree(treeData).map(node => (
                    <TreeNode 
                      key={node.path} 
                      node={node} 
                      level={0} 
                      selectedPaths={selectedPaths} 
                      toggleSelection={toggleSelection}
                      fetchDirectory={fetchDirectory}
                    />
                  ))}
                </div>
              </div>
            ) : !loading && !error && (
              <div className="h-full flex flex-col items-center justify-center text-gray-500 opacity-70">
                <Github className="w-16 h-16 mb-4 text-gray-700" />
                <p className="text-sm font-medium text-center px-4">Enter a repository ID to map its files.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Main Area - Summary & Status Dashboard */}
        <div className="hidden md:flex flex-1 bg-[#0b0f19] flex-col items-center justify-center p-8 relative overflow-y-auto">
          
          <div className="max-w-lg w-full bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl">
            <h3 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
              <Download className="w-6 h-6 text-yellow-500" />
              Export Control
            </h3>
            
            <div className="bg-gray-950 p-6 rounded-xl border border-gray-800 mb-8">
              <div className="flex justify-between items-end mb-3">
                <span className="text-gray-400 text-sm font-medium">Selected Files/Folders</span>
                <span className="text-4xl font-black text-yellow-500 leading-none">{selectedPaths.size}</span>
              </div>
              <div className="h-px w-full bg-gray-800 my-4"></div>
              <p className="text-xs text-gray-500 flex items-start gap-2 leading-relaxed">
                <Info className="w-4 h-4 mt-0.5 shrink-0 text-gray-400"/>
                Checked folders are deeply crawled and resolved automatically upon download. If downloading from a private repository, ensure your API Token is active in settings.
              </p>
            </div>

            {downloadProgress && (
              <div className="mb-8 p-5 bg-yellow-500/10 rounded-xl border border-yellow-500/30">
                <p className="text-sm font-semibold text-yellow-400 mb-4">{downloadProgress.message}</p>
                <div className="w-full bg-gray-950 rounded-full h-3 mb-3 overflow-hidden border border-gray-800">
                  <div 
                    className="bg-yellow-500 h-3 rounded-full transition-all duration-300 ease-out relative overflow-hidden" 
                    style={{ width: `${downloadProgress.total ? (downloadProgress.current / downloadProgress.total) * 100 : 0}%` }}
                  >
                    <div className="absolute inset-0 bg-white/20 w-full h-full animate-[shimmer_2s_infinite]"></div>
                  </div>
                </div>
                {downloadProgress.total > 0 && (
                  <div className="flex justify-between text-xs text-gray-400 font-bold tracking-wide">
                    <span>{downloadProgress.current} OF {downloadProgress.total}</span>
                    <span className="text-yellow-500">{((downloadProgress.current / downloadProgress.total) * 100).toFixed(0)}%</span>
                  </div>
                )}
              </div>
            )}

            <button 
              onClick={handleDownload}
              disabled={selectedPaths.size === 0 || downloading}
              className="w-full py-4 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed disabled:shadow-none text-gray-950 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all shadow-[0_0_20px_rgba(234,179,8,0.15)] hover:shadow-[0_0_30px_rgba(234,179,8,0.3)] active:scale-[0.98]"
            >
              {downloading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Download className="w-6 h-6" />}
              {downloading ? 'Processing Download...' : 'Download as ZIP'}
            </button>
            <p className="text-[11px] text-gray-600 mt-5 text-center px-4 leading-relaxed">
              Files are requested and zipped directly in your browser. Avoid downloading extremely large models (e.g. multi-GB Safetensors) via this method to prevent browser memory exhaustion.
            </p>
          </div>
        </div>
      </main>

      {/* Settings Modal overlay */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden transform transition-all">
            <div className="flex justify-between items-center p-5 border-b border-gray-800 bg-gray-900/50">
              <h3 className="font-bold text-white flex items-center gap-2 text-lg">
                <Key className="w-5 h-5 text-yellow-500" />
                API Settings
              </h3>
              <button 
                onClick={() => setShowSettings(false)} 
                className="text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg p-1.5 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6">
              <label className="block text-sm font-semibold text-gray-200 mb-2">
                Hugging Face User Token
              </label>
              <p className="text-xs text-gray-400 mb-4 leading-relaxed">
                Add your token to access and download from <span className="text-white font-medium">Private</span> Spaces, Models, or Datasets. Your token is <span className="text-yellow-500 font-medium">only stored locally in memory</span> during this active session and will clear on reload.
              </p>
              <input 
                type="password" 
                value={hfToken}
                onChange={(e) => setHfToken(e.target.value)}
                placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full p-3.5 bg-gray-950 border border-gray-700 rounded-xl text-sm text-white focus:outline-none focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 mb-6 transition-all"
              />
              <div className="flex justify-end gap-3 pt-2">
                <button 
                  onClick={() => setShowSettings(false)}
                  className="px-6 py-2.5 text-sm font-bold text-gray-950 bg-yellow-500 hover:bg-yellow-400 rounded-xl transition-colors"
                >
                  Save & Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
