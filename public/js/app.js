/**
 * CampusXchange Client Application Controller
 */

// --- Configuration ---
// When deploying, replace this string with your Railway backend domain (e.g. 'https://campusxchange-production.up.railway.app')
const CONFIG = {
  BACKEND_URL: 'https://campusxchange-production.up.railway.app' // Paste your Railway URL here
};

// --- Global Application State ---
const state = {
  user: JSON.parse(localStorage.getItem('cx_user')) || null,
  token: localStorage.getItem('cx_token') || null,
  currentView: 'home', // 'home' | 'dashboard'
  currentCategory: 'all',
  listings: [],
  filteredListings: [],
  activeSlide: 0,
  carouselInterval: null,
  uploadedImageUrl: null,
  chatPollingInterval: null,
  unreadPollingInterval: null,
  activeChatUser: null,
  activeChatListing: null,
  currentInboxThread: null,
  conversations: [],
  socket: null
};

// --- API Helpers ---
const API = {
  baseUrl: CONFIG.BACKEND_URL && !window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1')
    ? `${CONFIG.BACKEND_URL}/api`
    : '/api',


  getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) {
      headers['Authorization'] = `Bearer ${state.token}`;
    }
    return headers;
  },

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = this.getHeaders();
    
    // For uploads, we don't want to set Content-Type header manually (let fetch generate boundary)
    if (options.body && options.body instanceof FormData) {
      delete headers['Content-Type'];
    }

    const config = {
      ...options,
      headers: {
        ...headers,
        ...options.headers
      }
    };

    try {
      const response = await fetch(url, config);
      const data = await response.json();
      
      if (!response.ok) {
        const error = new Error(data.message || 'Something went wrong');
        error.status = response.status;
        error.unverified = data.unverified;
        throw error;
      }
      return data;
    } catch (err) {
      console.error(`API Error (${endpoint}):`, err.message);
      throw err;
    }
  },

  auth: {
    register: (userData) => API.request('/auth/register', { method: 'POST', body: JSON.stringify(userData) }),
    verifyEmail: (email, otp) => API.request('/auth/verify-email', { method: 'POST', body: JSON.stringify({ email, otp }) }),
    login: (credentials) => API.request('/auth/login', { method: 'POST', body: JSON.stringify(credentials) }),
    me: () => API.request('/auth/me'),
    forgotPassword: (email) => API.request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
    resetPassword: (resetData) => API.request('/auth/reset-password', { method: 'POST', body: JSON.stringify(resetData) })
  },

  listings: {
    getAll: (params = {}) => {
      const query = new URLSearchParams();
      if (params.search) query.append('search', params.search);
      if (params.category && params.category !== 'all') query.append('category', params.category);
      if (params.transactionType) query.append('transactionType', params.transactionType);
      if (params.status) query.append('status', params.status);
      if (params.owner) query.append('owner', params.owner);
      
      return API.request(`/listings?${query.toString()}`);
    },
    getOne: (id) => API.request(`/listings/${id}`),
    create: (listingData) => API.request('/listings', { method: 'POST', body: JSON.stringify(listingData) }),
    update: (id, listingData) => API.request(`/listings/${id}`, { method: 'PUT', body: JSON.stringify(listingData) }),
    delete: (id) => API.request(`/listings/${id}`, { method: 'DELETE' })
  },

  upload: {
    image: (formData) => API.request('/upload', { method: 'POST', body: formData })
  },

  messages: {
    send: (msgData) => API.request('/messages', { method: 'POST', body: JSON.stringify(msgData) }),
    getConversations: () => API.request('/messages/conversations'),
    getThread: (userId, listingId) => API.request(`/messages/thread/${userId}?listingId=${listingId}`),
    getUnreadCount: () => API.request('/messages/unread-count')
  }
};

// --- Toast Notifications ---
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = 'fa-circle-check';
  if (type === 'error') icon = 'fa-circle-exclamation';
  if (type === 'info') icon = 'fa-circle-info';
  
  toast.innerHTML = `
    <i class="fa-solid ${icon}"></i>
    <span>${message}</span>
  `;
  
  container.appendChild(toast);
  
  // Animate in
  setTimeout(() => toast.classList.add('show'), 50);
  
  // Remove after 3.5s
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// --- Unread Messages Polling ---
async function checkUnreadMessagesCount() {
  if (!state.token || !state.user) {
    const navDot = document.getElementById('nav-unread-dot');
    const inboxBadge = document.getElementById('dash-inbox-badge');
    if (navDot) navDot.style.display = 'none';
    if (inboxBadge) inboxBadge.style.display = 'none';
    return;
  }

  try {
    const data = await API.messages.getUnreadCount();
    const count = data.unreadCount || 0;
    
    const navDot = document.getElementById('nav-unread-dot');
    const inboxBadge = document.getElementById('dash-inbox-badge');

    if (count > 0) {
      if (navDot) navDot.style.display = 'block';
      if (inboxBadge) {
        inboxBadge.textContent = count;
        inboxBadge.style.display = 'block';
      }
    } else {
      if (navDot) navDot.style.display = 'none';
      if (inboxBadge) inboxBadge.style.display = 'none';
    }
  } catch (err) {
    console.error('Error checking unread messages count:', err);
  }
}

function startUnreadPolling() {
  stopUnreadPolling();
  if (state.token && state.user) {
    checkUnreadMessagesCount();
    state.unreadPollingInterval = setInterval(checkUnreadMessagesCount, 10000);
  }
}

function stopUnreadPolling() {
  if (state.unreadPollingInterval) {
    clearInterval(state.unreadPollingInterval);
    state.unreadPollingInterval = null;
  }
}

// --- Socket.IO Real-time Messaging ---
function initSocket() {
  if (state.socket) return;

  const socketUrl = CONFIG.BACKEND_URL && !window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1')
    ? CONFIG.BACKEND_URL
    : window.location.origin;

  state.socket = io(socketUrl);

  state.socket.on('connect', () => {
    console.log('Socket.IO connected, ID:', state.socket.id);
    if (state.user) {
      state.socket.emit('join', state.user.id || state.user._id);
    }
  });

  state.socket.on('messageReceived', (message) => {
    console.log('Socket.IO messageReceived:', message);
    handleIncomingSocketMessage(message);
  });

  state.socket.on('disconnect', () => {
    console.log('Socket.IO disconnected');
  });
}

function disconnectSocket() {
  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }
}

function handleIncomingSocketMessage(message) {
  const currentUserId = state.user ? (state.user.id || state.user._id) : null;
  if (!currentUserId) return;

  const msgSenderId = message.sender._id || message.sender.id || message.sender;
  const msgReceiverId = message.receiver._id || message.receiver.id || message.receiver;
  const msgListingId = message.listing._id || message.listing.id || message.listing;

  if (msgReceiverId === currentUserId) {
    let updatedActiveChat = false;

    // 1. If we are currently chatting with this user in the Dashboard Inbox
    if (state.currentInboxThread) {
      const otherUserId = state.currentInboxThread.otherUser._id || state.currentInboxThread.otherUser.id;
      const listingId = state.currentInboxThread.listing._id || state.currentInboxThread.listing.id;

      if (msgSenderId === otherUserId && msgListingId === listingId) {
        fetchInboxMessages();
        updatedActiveChat = true;
      }
    }

    // 2. If we are currently chatting with this user in the Quick Chat overlay
    if (state.activeChatUser && state.activeChatListing) {
      const otherUserId = state.activeChatUser._id || state.activeChatUser.id;
      const listingId = state.activeChatListing._id || state.activeChatListing.id;

      if (msgSenderId === otherUserId && msgListingId === listingId) {
        fetchQuickChatMessages();
        updatedActiveChat = true;
      }
    }

    // 3. If we didn't update an active open chat thread, show a toast notification and reload the inbox
    if (!updatedActiveChat) {
      const senderName = message.sender && typeof message.sender === 'object' ? message.sender.name : 'Another student';
      showToast(`New message from ${senderName}: "${message.content}"`, 'info');
      checkUnreadMessagesCount();
      if (state.currentView === 'dashboard' && document.getElementById('dash-inbox-section').style.display === 'block') {
        loadInbox(true);
      }
    }
  }
}

// --- Auth Session Management ---
function setSession(user, token) {
  state.user = user;
  state.token = token;
  localStorage.setItem('cx_user', JSON.stringify(user));
  localStorage.setItem('cx_token', token);
  updateNavbar();
  startUnreadPolling();
  initSocket();
}

function clearSession() {
  state.user = null;
  state.token = null;
  localStorage.removeItem('cx_user');
  localStorage.removeItem('cx_token');
  updateNavbar();
  setView('home');
  stopUnreadPolling();
  checkUnreadMessagesCount();
  disconnectSocket();
  showToast('Logged out successfully', 'info');
}

// --- Navigation & Routing ---
function setView(viewName) {
  state.currentView = viewName;
  
  const homeView = document.getElementById('view-home');
  const dashView = document.getElementById('view-dashboard');
  
  const homeLink = document.getElementById('nav-home-btn');
  const dashLink = document.getElementById('nav-profile-dropdown');
  
  if (viewName === 'home') {
    homeView.style.display = 'block';
    dashView.style.display = 'none';
    if (homeLink) homeLink.classList.add('active');
    stopChatPolling();
    closeQuickChat();
    fetchListings();
    startCarousel();
  } else if (viewName === 'dashboard') {
    if (!state.token) {
      openModal('auth-modal');
      return;
    }
    homeView.style.display = 'none';
    dashView.style.display = 'grid';
    if (homeLink) homeLink.classList.remove('active');
    stopCarousel();
    stopChatPolling();
    closeQuickChat();
    
    // Reset dashboard section visibility to listings by default
    document.querySelectorAll('.dashboard-menu-item').forEach(m => m.classList.remove('active'));
    document.getElementById('dash-menu-listings').classList.add('active');
    document.getElementById('dash-listings-section').style.display = 'block';
    document.getElementById('dash-inbox-section').style.display = 'none';
    
    loadDashboardData();
  }
}

function updateNavbar() {
  const loginBtn = document.getElementById('nav-login-btn');
  const profileDropdown = document.getElementById('nav-profile-dropdown');
  const avatar = document.getElementById('nav-user-avatar');
  const nameSpan = document.getElementById('nav-user-name');
  
  if (state.token && state.user) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (profileDropdown) profileDropdown.style.display = 'flex';
    if (avatar) avatar.textContent = state.user.name.charAt(0).toUpperCase();
    if (nameSpan) nameSpan.textContent = state.user.name;
  } else {
    if (loginBtn) loginBtn.style.display = 'inline-flex';
    if (profileDropdown) profileDropdown.style.display = 'none';
  }
}

// --- Slider Carousel Logic ---
function startCarousel() {
  stopCarousel();
  state.carouselInterval = setInterval(() => {
    navigateCarousel(1);
  }, 5000);
}

function stopCarousel() {
  if (state.carouselInterval) {
    clearInterval(state.carouselInterval);
    state.carouselInterval = null;
  }
}

function navigateCarousel(direction) {
  const slides = document.querySelectorAll('.carousel-slide');
  const dots = document.querySelectorAll('.carousel-dot');
  if (slides.length === 0) return;
  
  slides[state.activeSlide].classList.remove('active');
  dots[state.activeSlide].classList.remove('active');
  
  state.activeSlide = (state.activeSlide + direction + slides.length) % slides.length;
  
  slides[state.activeSlide].classList.add('active');
  dots[state.activeSlide].classList.add('active');
}

// --- Modal Utilities ---
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = 'auto';
  }
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.classList.remove('active');
  });
  document.body.style.overflow = 'auto';
}

// --- Fetch and Render Listings ---
async function fetchListings() {
  try {
    const grid = document.getElementById('listings-grid');
    if (!grid) return;
    
    // Gather filter parameters
    const search = document.getElementById('global-search-input').value;
    
    // Transaction type filters (get checked checkboxes)
    const txCheckboxes = document.querySelectorAll('#filter-transaction-type input:checked');
    const transactionType = Array.from(txCheckboxes).map(cb => cb.value).join(',');
    
    // Status filters (get checked checkboxes)
    const statusCheckboxes = document.querySelectorAll('#filter-availability input:checked');
    const status = Array.from(statusCheckboxes).map(cb => cb.value).join(',');
    
    const params = {
      category: state.currentCategory
    };
    if (search.trim()) params.search = search.trim();
    if (transactionType) params.transactionType = transactionType;
    if (status) params.status = status;
    
    // Pull from API
    let listings = await API.listings.getAll(params);
    
    // Price range filtering (Done client side for real-time smoothness)
    const priceMin = parseFloat(document.getElementById('price-min').value);
    const priceMax = parseFloat(document.getElementById('price-max').value);
    
    if (!isNaN(priceMin)) {
      listings = listings.filter(l => l.price >= priceMin);
    }
    if (!isNaN(priceMax)) {
      listings = listings.filter(l => l.price <= priceMax);
    }
    
    // Location Filter
    const location = document.getElementById('filter-hostel').value;
    if (location !== 'all') {
      listings = listings.filter(l => l.hostel === location);
    }
    
    state.listings = listings;
    
    // Apply sorting
    sortAndRenderListings();
  } catch (err) {
    showToast('Failed to fetch listings', 'error');
  }
}

function sortAndRenderListings() {
  const sortBy = document.getElementById('listings-sort-select').value;
  const grid = document.getElementById('listings-grid');
  if (!grid) return;
  
  let sorted = [...state.listings];
  
  if (sortBy === 'price-low') {
    sorted.sort((a, b) => a.price - b.price);
  } else if (sortBy === 'price-high') {
    sorted.sort((a, b) => b.price - a.price);
  } else {
    // Default: recent (newest first, already sorted by backend, but make sure)
    sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  
  document.getElementById('listings-count-label').textContent = `Showing ${sorted.length} ${sorted.length === 1 ? 'listing' : 'listings'}`;
  
  if (sorted.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-face-frown"></i>
        <h3>No Listings Found</h3>
        <p>Try resetting filters or search query to find more items.</p>
      </div>
    `;
    return;
  }
  
  grid.innerHTML = sorted.map(item => {
    const txClass = `badge-${item.transactionType.toLowerCase()}`;
    const statusClass = `badge-${item.status.toLowerCase()}`;
    const timeString = formatTime(item.createdAt);
    const displayPrice = item.transactionType === 'Donate' ? 'FREE' : `₹${item.price.toLocaleString('en-IN')}`;
    
    return `
      <div class="product-card" onclick="viewProductDetail('${item._id}')">
        <div class="card-image-wrapper">
          <span class="badge badge-transaction ${txClass}">${item.transactionType}</span>
          <span class="badge badge-status ${statusClass}">${item.status}</span>
          <img src="${item.imageUrl || '/placeholder.png'}" alt="${item.title}" onerror="this.src='https://images.unsplash.com/photo-1531403009284-440f080d1e12?q=80&w=600&auto=format&fit=crop'">
        </div>
        <div class="card-details">
          <span class="card-category">${item.category}</span>
          <h3 class="card-title">${item.title}</h3>
          <div class="card-location-wrapper">
            <i class="fa-solid fa-location-dot"></i>
            <span>${item.hostel}</span>
          </div>
          <div class="card-footer">
            <span class="card-price">${displayPrice}</span>
            <span class="card-date">${timeString}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// --- Product Detail Viewer ---
async function viewProductDetail(id) {
  try {
    const item = await API.listings.getOne(id);
    if (!item) return;
    
    // Set text elements
    document.getElementById('detail-image').src = item.imageUrl || '/placeholder.png';
    document.getElementById('detail-image').onerror = function() {
      this.src = 'https://images.unsplash.com/photo-1531403009284-440f080d1e12?q=80&w=600&auto=format&fit=crop';
    };
    
    document.getElementById('detail-title').textContent = item.title;
    document.getElementById('detail-category').textContent = item.category;
    document.getElementById('detail-description').textContent = item.description;
    document.getElementById('detail-date').textContent = new Date(item.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    document.getElementById('detail-seller-name').textContent = item.owner ? item.owner.name : 'Unknown Student';
    document.getElementById('detail-seller-hostel').innerHTML = `<i class="fa-solid fa-location-dot"></i> ${item.hostel}`;
    
    // No email seller functionality as it is removed.
    
    // Set price label
    const priceSpan = document.getElementById('detail-price');
    if (item.transactionType === 'Donate') {
      priceSpan.textContent = 'FREE / DONATION';
    } else {
      priceSpan.textContent = `₹${item.price.toLocaleString('en-IN')}`;
    }
    
    // Set badge classes
    const txBadge = document.getElementById('detail-badge-type');
    txBadge.textContent = item.transactionType;
    txBadge.className = `badge badge-${item.transactionType.toLowerCase()}`;
    
    const statusBadge = document.getElementById('detail-badge-status');
    statusBadge.textContent = item.status;
    statusBadge.className = `badge badge-${item.status.toLowerCase()}`;
    
    // Setup owner specific action panel
    const ownerPanel = document.getElementById('detail-owner-actions');
    const isOwner = state.user && item.owner && (state.user.id === item.owner._id || state.user.id === item.owner.id || state.user.id === item.owner);
    
    if (isOwner) {
      ownerPanel.style.display = 'flex';
      
      // Select correct status in dropdown
      const statusSelect = document.getElementById('detail-owner-status-select');
      statusSelect.value = item.status;
      
      // Update dropdown option states based on type
      if (item.transactionType === 'Rent') {
        statusSelect.options[2].text = 'Mark as Rented'; // index 2 is rented
      } else {
        statusSelect.options[2].text = 'Mark as Sold';
      }
      
      // Store current item reference for edit/delete functions
      ownerPanel.dataset.itemId = item._id;
    } else {
      ownerPanel.style.display = 'none';
    }
    
    openModal('product-detail-modal');
  } catch (err) {
    showToast('Could not load item details', 'error');
  }
}

// --- Dashboard Logic ---
async function loadDashboardData() {
  try {
    const totalSpan = document.getElementById('stat-total');
    const activeSpan = document.getElementById('stat-active');
    const soldRentedSpan = document.getElementById('stat-sold-rented');
    const donationSpan = document.getElementById('stat-donations');
    
    // Set profile data
    document.getElementById('dash-user-name').textContent = state.user.name;
    document.getElementById('dash-user-email').textContent = state.user.email;
    document.getElementById('dash-user-hostel').innerHTML = `<i class="fa-solid fa-location-dot"></i> ${state.user.hostel}`;
    document.getElementById('dash-user-avatar').textContent = state.user.name.charAt(0).toUpperCase();
    
    // Fetch listings owned by current user
    const listings = await API.listings.getAll({ owner: state.user.id });
    
    // Compute stats
    const total = listings.length;
    const active = listings.filter(l => l.status === 'Available').length;
    const soldRented = listings.filter(l => l.status === 'Sold' || l.status === 'Rented').length;
    const donations = listings.filter(l => l.status === 'Donated').length;
    
    totalSpan.textContent = total;
    activeSpan.textContent = active;
    soldRentedSpan.textContent = soldRented;
    donationSpan.textContent = donations;
    
    // Render the listings table/list in dashboard
    const container = document.getElementById('my-listings-container');
    if (listings.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-tags"></i>
          <h3>No Listings Created Yet</h3>
          <p>Click "Create Listing" to start trading items on campus.</p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = listings.map(item => {
      const priceText = item.transactionType === 'Donate' ? 'Free' : `₹${item.price}`;
      const statusClass = `badge-${item.status.toLowerCase()}`;
      
      return `
        <div class="my-listing-row">
          <img src="${item.imageUrl || '/placeholder.png'}" alt="" class="my-listing-img" onerror="this.src='https://images.unsplash.com/photo-1531403009284-440f080d1e12?q=80&w=600&auto=format&fit=crop'">
          <div class="my-listing-info">
            <h4 class="my-listing-title">${item.title}</h4>
            <div class="my-listing-meta">
              <span>Category: <strong>${item.category}</strong></span>
              <span>•</span>
              <span>Type: <strong>${item.transactionType}</strong></span>
              <span>•</span>
              <span>Price: <strong>${priceText}</strong></span>
            </div>
          </div>
          
          <span class="badge ${statusClass}" style="position:relative; top:0; right:0; margin-right:1rem;">${item.status}</span>
          
          <div class="my-listing-actions">
            <!-- Mark Actions -->
            <select class="btn btn-status-dropdown" onchange="changeListingStatus('${item._id}', this.value)" style="padding:0.4rem 0.6rem; font-size:0.8rem; border-radius:var(--border-radius-md);">
              <option value="Available" ${item.status === 'Available' ? 'selected' : ''}>Available</option>
              <option value="Sold" ${item.status === 'Sold' ? 'selected' : ''}>Sold</option>
              <option value="Rented" ${item.status === 'Rented' ? 'selected' : ''}>Rented</option>
              <option value="Exchanged" ${item.status === 'Exchanged' ? 'selected' : ''}>Exchanged</option>
              <option value="Donated" ${item.status === 'Donated' ? 'selected' : ''}>Donated</option>
            </select>
            
            <button class="btn-icon" onclick="triggerEditListing('${item._id}')" title="Edit Listing"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-icon btn-icon-delete" onclick="deleteListing('${item._id}')" title="Delete Listing"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
      `;
    }).join('');
    
  } catch (err) {
    showToast('Failed to load user dashboard details', 'error');
  }
}

// --- CRUD Actions ---
async function changeListingStatus(id, newStatus) {
  try {
    await API.listings.update(id, { status: newStatus });
    showToast(`Status updated to ${newStatus}`);
    
    // Refresh views
    if (state.currentView === 'dashboard') {
      loadDashboardData();
    } else {
      fetchListings();
    }
    
    // If details modal is open and has this item, update it
    const modalOverlay = document.getElementById('product-detail-modal');
    if (modalOverlay.classList.contains('active')) {
      const statusBadge = document.getElementById('detail-badge-status');
      statusBadge.textContent = newStatus;
      statusBadge.className = `badge badge-${newStatus.toLowerCase()}`;
    }
  } catch (err) {
    showToast('Failed to update listing status', 'error');
  }
}

async function triggerEditListing(id) {
  try {
    closeAllModals();
    const item = await API.listings.getOne(id);
    if (!item) return;
    
    document.getElementById('listing-edit-id').value = item._id;
    document.getElementById('listing-title').value = item.title;
    document.getElementById('listing-category').value = item.category;
    document.getElementById('listing-type').value = item.transactionType;
    document.getElementById('listing-price').value = item.price;
    document.getElementById('listing-hostel').value = item.hostel;
    document.getElementById('listing-desc').value = item.description;
    
    // Setup Image Preview
    state.uploadedImageUrl = item.imageUrl;
    document.getElementById('listing-image-url').value = item.imageUrl;
    document.getElementById('upload-preview-img').src = item.imageUrl;
    document.getElementById('upload-preview-box').style.display = 'block';
    document.getElementById('upload-btn-ui').style.display = 'none';
    
    document.getElementById('listing-form-title').textContent = 'Edit Listing';
    document.getElementById('listing-form-submit-btn').textContent = 'Save Changes';
    
    openModal('listing-form-modal');
  } catch (err) {
    showToast('Failed to load item info for editing', 'error');
  }
}

async function deleteListing(id) {
  if (!confirm('Are you sure you want to delete this listing permanently?')) return;
  
  try {
    await API.listings.delete(id);
    showToast('Listing deleted successfully');
    closeAllModals();
    
    if (state.currentView === 'dashboard') {
      loadDashboardData();
    } else {
      fetchListings();
    }
  } catch (err) {
    showToast('Failed to delete listing', 'error');
  }
}

// --- Image Upload Handling ---
async function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const formData = new FormData();
  formData.append('image', file);
  
  // Show spinner / loading UI
  const uploadBtnUI = document.getElementById('upload-btn-ui');
  const previewBox = document.getElementById('upload-preview-box');
  const previewImg = document.getElementById('upload-preview-img');
  
  uploadBtnUI.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem;"></i><span>Uploading image...</span>`;
  
  try {
    const data = await API.upload.image(formData);
    state.uploadedImageUrl = data.imageUrl;
    
    // Update inputs
    document.getElementById('listing-image-url').value = data.imageUrl;
    previewImg.src = data.imageUrl;
    
    // Toggle displays
    uploadBtnUI.style.display = 'none';
    previewBox.style.display = 'block';
    showToast('Image uploaded successfully');
  } catch (err) {
    showToast(err.message || 'Image upload failed', 'error');
    resetImageUpload();
  } finally {
    // Reset original upload button text
    uploadBtnUI.innerHTML = `
      <i class="fa-solid fa-cloud-arrow-up" style="font-size: 1.5rem;"></i>
      <span>Choose Image or Drag & Drop</span>
      <span style="font-size: 0.75rem; font-weight: normal; color: var(--text-muted);">Max size: 5MB (PNG, JPG, WEBP)</span>
    `;
  }
}

function resetImageUpload() {
  state.uploadedImageUrl = null;
  document.getElementById('listing-image-url').value = '';
  document.getElementById('listing-image-file').value = '';
  document.getElementById('upload-preview-box').style.display = 'none';
  document.getElementById('upload-btn-ui').style.display = 'flex';
}

// --- Date Formatter Utility ---
function formatTime(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now - date);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays <= 1) {
    return 'Today';
  } else if (diffDays === 2) {
    return 'Yesterday';
  } else if (diffDays <= 7) {
    return `${diffDays - 1}d ago`;
  } else {
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
}

// --- Setup Event Listeners ---
function setupEventListeners() {
  
  // 1. Navigation View Switchers
  document.getElementById('nav-logo-btn').addEventListener('click', () => setView('home'));
  document.getElementById('nav-home-btn').addEventListener('click', () => setView('home'));
  document.getElementById('nav-profile-dropdown').addEventListener('click', () => setView('dashboard'));
  
  // Dashboard navigation shortcuts
  document.getElementById('dash-menu-listings').addEventListener('click', () => {
    document.querySelectorAll('.dashboard-menu-item').forEach(m => m.classList.remove('active'));
    document.getElementById('dash-menu-listings').classList.add('active');
    document.getElementById('dash-listings-section').style.display = 'block';
    document.getElementById('dash-inbox-section').style.display = 'none';
    stopChatPolling();
    loadDashboardData();
  });

  document.getElementById('dash-menu-inbox').addEventListener('click', () => {
    document.querySelectorAll('.dashboard-menu-item').forEach(m => m.classList.remove('active'));
    document.getElementById('dash-menu-inbox').classList.add('active');
    document.getElementById('dash-listings-section').style.display = 'none';
    document.getElementById('dash-inbox-section').style.display = 'block';
    loadInbox();
  });
  
  document.getElementById('dash-menu-sell').addEventListener('click', () => {
    document.getElementById('listing-edit-id').value = '';
    document.getElementById('listing-form-title').textContent = 'List an Item';
    document.getElementById('listing-form-submit-btn').textContent = 'Submit Listing';
    document.getElementById('listing-form').reset();
    resetImageUpload();
    openModal('listing-form-modal');
  });
  
  document.getElementById('dash-btn-add-item').addEventListener('click', () => {
    document.getElementById('listing-edit-id').value = '';
    document.getElementById('listing-form-title').textContent = 'List an Item';
    document.getElementById('listing-form-submit-btn').textContent = 'Submit Listing';
    document.getElementById('listing-form').reset();
    resetImageUpload();
    openModal('listing-form-modal');
  });

  document.getElementById('dash-menu-logout').addEventListener('click', clearSession);

  // 2. Open Sell/Rent Listing Form (Requires Login)
  document.getElementById('nav-sell-btn').addEventListener('click', () => {
    if (!state.token) {
      openModal('auth-modal');
      return;
    }
    document.getElementById('listing-edit-id').value = '';
    document.getElementById('listing-form-title').textContent = 'List an Item';
    document.getElementById('listing-form-submit-btn').textContent = 'Submit Listing';
    document.getElementById('listing-form').reset();
    resetImageUpload();
    openModal('listing-form-modal');
  });

  // 3. Open Login Dialog
  document.getElementById('nav-login-btn').addEventListener('click', () => {
    openModal('auth-modal');
  });

  // Close modals clicking cross
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', closeAllModals);
  });

  // Close modals clicking overlay
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeAllModals();
      }
    });
  });

  // 4. Auth Modal Tab Toggling
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const forgotForm = document.getElementById('forgot-form');
  const resetForm = document.getElementById('reset-form');
  const authTitle = document.getElementById('auth-modal-title');
  const authSwitchPrompt = document.getElementById('auth-switch-prompt');
  const authSwitchBtn = document.getElementById('auth-switch-btn');

  function toggleAuthTab(tab) {
    // Hide forgot password / verify email flows
    forgotForm.style.display = 'none';
    resetForm.style.display = 'none';
    document.getElementById('verify-email-form').style.display = 'none';
    
    // Ensure tabs container is visible
    document.querySelector('.modal-header div').style.display = 'flex';

    if (tab === 'login') {
      tabLogin.style.fontWeight = '700';
      tabLogin.style.color = 'var(--bg-dark)';
      tabLogin.style.borderBottom = '2px solid var(--bg-dark)';
      
      tabRegister.style.fontWeight = '600';
      tabRegister.style.color = 'var(--text-secondary)';
      tabRegister.style.borderBottom = 'none';
      
      loginForm.style.display = 'block';
      registerForm.style.display = 'none';
      authTitle.textContent = 'Sign In';
      authSwitchPrompt.innerHTML = `Don't have an account? <span id="auth-switch-btn" style="font-weight:700; color:var(--bg-dark); cursor:pointer;">Register</span>`;
    } else {
      tabRegister.style.fontWeight = '700';
      tabRegister.style.color = 'var(--bg-dark)';
      tabRegister.style.borderBottom = '2px solid var(--bg-dark)';
      
      tabLogin.style.fontWeight = '600';
      tabLogin.style.color = 'var(--text-secondary)';
      tabLogin.style.borderBottom = 'none';
      
      registerForm.style.display = 'block';
      loginForm.style.display = 'none';
      authTitle.textContent = 'Create Account';
      authSwitchPrompt.innerHTML = `Already have an account? <span id="auth-switch-btn" style="font-weight:700; color:var(--bg-dark); cursor:pointer;">Login</span>`;
    }
    
    // Re-bind switch button since we overwrite innerHTML
    document.getElementById('auth-switch-btn').addEventListener('click', () => {
      toggleAuthTab(tab === 'login' ? 'register' : 'login');
    });
  }

  tabLogin.addEventListener('click', () => toggleAuthTab('login'));
  tabRegister.addEventListener('click', () => toggleAuthTab('register'));
  authSwitchBtn.addEventListener('click', () => toggleAuthTab('register'));

  // Forgot Password View Toggle Click
  document.getElementById('login-forgot-link').addEventListener('click', () => {
    loginForm.style.display = 'none';
    registerForm.style.display = 'none';
    forgotForm.style.display = 'block';
    resetForm.style.display = 'none';
    
    // Hide headers tabs bar
    document.querySelector('.modal-header div').style.display = 'none';
    authTitle.textContent = 'Reset Password';
    
    authSwitchPrompt.innerHTML = `Back to <span id="auth-switch-btn" style="font-weight:700; color:var(--bg-dark); cursor:pointer;">Login</span>`;
    document.getElementById('auth-switch-btn').addEventListener('click', () => {
      toggleAuthTab('login');
    });
  });

  // 5. Auth Submits
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    try {
      const data = await API.auth.login({ email, password });
      setSession(data.user, data.token);
      closeAllModals();
      showToast(`Welcome back, ${data.user.name}!`);
      
      if (state.currentView === 'dashboard') {
        loadDashboardData();
      } else {
        fetchListings();
      }
    } catch (err) {
      if (err.unverified || err.status === 403) {
        showToast(err.message, 'info');
        document.getElementById('verify-email-form').dataset.email = email;
        
        // Switch Auth Modal view to Verification
        document.querySelector('.modal-header div').style.display = 'none';
        loginForm.style.display = 'none';
        document.getElementById('verify-email-form').style.display = 'block';
        authTitle.textContent = 'Verify Email';
        authSwitchPrompt.innerHTML = `Back to <span id="auth-switch-btn" style="font-weight:700; color:var(--bg-dark); cursor:pointer;">Login</span>`;
        document.getElementById('auth-switch-btn').addEventListener('click', () => {
          toggleAuthTab('login');
        });
        return;
      }
      showToast(err.message, 'error');
    }
  });

  // Forgot Password - Send OTP Submit
  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value;
    const submitBtn = forgotForm.querySelector('button[type="submit"]');
    
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending code...';
    
    try {
      const data = await API.auth.forgotPassword(email);
      showToast(data.message);
      
      // Switch screen to enter code
      forgotForm.style.display = 'none';
      resetForm.style.display = 'block';
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Reset Code';
    }
  });

  // Forgot Password - Verify & Reset Password Submit
  resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value;
    const otp = document.getElementById('reset-otp').value;
    const newPassword = document.getElementById('reset-new-password').value;
    
    try {
      const data = await API.auth.resetPassword({ email, otp, newPassword });
      setSession(data.user, data.token);
      closeAllModals();
      showToast('Password reset successfully! You are now logged in.');
      
      if (state.currentView === 'dashboard') {
        loadDashboardData();
      } else {
        fetchListings();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('register-name').value;
    const email = document.getElementById('register-email').value;
    const hostel = document.getElementById('register-hostel').value;
    const password = document.getElementById('register-password').value;
    
    try {
      const data = await API.auth.register({ name, email, hostel, password });
      if (data.unverified) {
        showToast(data.message, 'info');
        document.getElementById('verify-email-form').dataset.email = email;
        
        // Hide headers tabs bar and show verification form
        document.querySelector('.modal-header div').style.display = 'none';
        registerForm.style.display = 'none';
        document.getElementById('verify-email-form').style.display = 'block';
        authTitle.textContent = 'Verify Email';
        authSwitchPrompt.innerHTML = `Back to <span id="auth-switch-btn" style="font-weight:700; color:var(--bg-dark); cursor:pointer;">Login</span>`;
        document.getElementById('auth-switch-btn').addEventListener('click', () => {
          toggleAuthTab('login');
        });
        return;
      }
      
      setSession(data.user, data.token);
      closeAllModals();
      showToast(`Account created! Welcome, ${data.user.name}`);
      
      if (state.currentView === 'dashboard') {
        loadDashboardData();
      } else {
        fetchListings();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // 6. Listings Creation & Edit Submit
  document.getElementById('listing-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('listing-edit-id').value;
    
    const listingData = {
      title: document.getElementById('listing-title').value,
      category: document.getElementById('listing-category').value,
      transactionType: document.getElementById('listing-type').value,
      price: parseFloat(document.getElementById('listing-price').value) || 0,
      hostel: document.getElementById('listing-hostel').value,
      description: document.getElementById('listing-desc').value,
      imageUrl: document.getElementById('listing-image-url').value
    };

    if (!listingData.imageUrl) {
      showToast('Please upload an image of the item', 'error');
      return;
    }

    try {
      if (editId) {
        // Edit mode
        await API.listings.update(editId, listingData);
        showToast('Listing updated successfully');
      } else {
        // Create mode
        await API.listings.create(listingData);
        showToast('Listing published successfully');
      }
      
      closeAllModals();
      
      if (state.currentView === 'dashboard') {
        loadDashboardData();
      } else {
        fetchListings();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // File Upload listener
  document.getElementById('listing-image-file').addEventListener('change', handleImageUpload);
  document.getElementById('upload-preview-remove-btn').addEventListener('click', resetImageUpload);

  // 7. Interactive Filters Sidebar & Category Showcase
  
  // Category circular roundels
  document.querySelectorAll('.category-roundel').forEach(roundel => {
    roundel.addEventListener('click', () => {
      document.querySelectorAll('.category-roundel').forEach(r => r.classList.remove('active'));
      roundel.classList.add('active');
      state.currentCategory = roundel.dataset.category;
      fetchListings();
    });
  });

  // Carousel button clicks
  document.getElementById('carousel-prev-btn').addEventListener('click', () => {
    stopCarousel();
    navigateCarousel(-1);
    startCarousel();
  });
  document.getElementById('carousel-next-btn').addEventListener('click', () => {
    stopCarousel();
    navigateCarousel(1);
    startCarousel();
  });

  // Carousel banner CTA buttons
  document.querySelectorAll('.start-browsing-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const offset = document.getElementById('category-roundels-container').offsetTop;
      window.scrollTo({ top: offset - 100, behavior: 'smooth' });
    });
  });

  document.querySelectorAll('.carousel-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      stopCarousel();
      const slides = document.querySelectorAll('.carousel-slide');
      const dots = document.querySelectorAll('.carousel-dot');
      
      slides[state.activeSlide].classList.remove('active');
      dots[state.activeSlide].classList.remove('active');
      
      state.activeSlide = parseInt(dot.dataset.slide);
      
      slides[state.activeSlide].classList.add('active');
      dots[state.activeSlide].classList.add('active');
      startCarousel();
    });
  });

  // Search input listeners (debounced)
  let searchTimeout = null;
  document.getElementById('global-search-input').addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      fetchListings();
    }, 400);
  });

  // Filter section event listeners (checkbox changes, selects, ranges)
  document.querySelectorAll('#filter-transaction-type input').forEach(cb => {
    cb.addEventListener('change', fetchListings);
  });
  document.querySelectorAll('#filter-availability input').forEach(cb => {
    cb.addEventListener('change', fetchListings);
  });
  document.getElementById('price-min').addEventListener('input', fetchListings);
  document.getElementById('price-max').addEventListener('input', fetchListings);
  document.getElementById('filter-hostel').addEventListener('change', fetchListings);
  document.getElementById('listings-sort-select').addEventListener('change', sortAndRenderListings);

  // Reset filters
  document.getElementById('btn-reset-filters').addEventListener('click', () => {
    // Checkboxes
    document.querySelectorAll('#filter-transaction-type input').forEach(cb => cb.checked = true);
    document.querySelectorAll('#filter-availability input').forEach((cb, idx) => cb.checked = idx === 0); // Check only "Available"
    
    // Inputs
    document.getElementById('price-min').value = '';
    document.getElementById('price-max').value = '';
    document.getElementById('filter-hostel').value = 'all';
    document.getElementById('global-search-input').value = '';
    
    // Reset roundels
    document.querySelectorAll('.category-roundel').forEach(r => r.classList.remove('active'));
    document.querySelectorAll('.category-roundel')[0].classList.add('active');
    state.currentCategory = 'all';
    
    fetchListings();
    showToast('Filters cleared', 'info');
  });

  // 8. Owner actions in Product Details Modal
  document.getElementById('detail-owner-status-select').addEventListener('change', (e) => {
    const itemId = document.getElementById('detail-owner-actions').dataset.itemId;
    changeListingStatus(itemId, e.target.value);
  });

  document.getElementById('detail-owner-edit-btn').addEventListener('click', () => {
    const itemId = document.getElementById('detail-owner-actions').dataset.itemId;
    triggerEditListing(itemId);
  });

  document.getElementById('detail-owner-delete-btn').addEventListener('click', () => {
    const itemId = document.getElementById('detail-owner-actions').dataset.itemId;
    deleteListing(itemId);
  });

  // Floating Chat Box event listeners
  document.getElementById('quick-chat-close-btn').addEventListener('click', closeQuickChat);
  document.getElementById('quick-chat-form').addEventListener('submit', sendQuickChatMessage);

  // Detail Modal chat with seller action
  document.getElementById('detail-seller-chat-btn').addEventListener('click', async () => {
    if (!state.token) {
      closeAllModals();
      openModal('auth-modal');
      return;
    }
    const itemId = document.getElementById('detail-owner-actions').dataset.itemId;
    try {
      const item = await API.listings.getOne(itemId);
      closeAllModals();
      openQuickChat(item.owner, item);
    } catch (err) {
      showToast('Could not initiate chat thread', 'error');
    }
  });

  // Verify Email Form submit
  const verifyEmailForm = document.getElementById('verify-email-form');
  verifyEmailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = verifyEmailForm.dataset.email;
    const otp = document.getElementById('verify-email-otp').value;
    
    try {
      const data = await API.auth.verifyEmail(email, otp);
      setSession(data.user, data.token);
      closeAllModals();
      showToast(data.message || 'Email verified successfully!');
      
      if (state.currentView === 'dashboard') {
        loadDashboardData();
      } else {
        fetchListings();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// --- In-App Chat & Inbox Controller Logic ---

function stopChatPolling() {
  if (state.chatPollingInterval) {
    clearInterval(state.chatPollingInterval);
    state.chatPollingInterval = null;
  }
}

// 1. Dashboard Inbox Loader
async function loadInbox(keepActiveThread = false) {
  try {
    const chatsContainer = document.getElementById('inbox-chats-container');
    const threadContainer = document.getElementById('inbox-thread-container');
    
    if (!keepActiveThread) {
      stopChatPolling();
      state.currentInboxThread = null;
      
      threadContainer.innerHTML = `
        <div class="chat-thread-placeholder">
          <i class="fa-solid fa-comments" style="font-size:3rem; color:var(--text-muted); margin-bottom:1rem;"></i>
          <p>Select a conversation from the list to start chatting about an item.</p>
        </div>
      `;
    }

    const conversations = await API.messages.getConversations();
    state.conversations = conversations;
    
    if (conversations.length === 0) {
      chatsContainer.innerHTML = `
        <div style="padding:2rem; text-align:center; color:var(--text-secondary); font-size:0.9rem;">
          <i class="fa-solid fa-envelope-open" style="font-size:2rem; margin-bottom:0.5rem; display:block;"></i>
          No active chats yet.
        </div>
      `;
      return;
    }

    chatsContainer.innerHTML = conversations.map((c, index) => {
      const activeClass = state.currentInboxThread && 
        (state.currentInboxThread.otherUser._id === c.otherUser._id || state.currentInboxThread.otherUser.id === c.otherUser.id) && 
        (state.currentInboxThread.listing._id === c.listing._id || state.currentInboxThread.listing.id === c.listing.id) ? 'active' : '';
      
      const timeStr = formatTime(c.lastMessageDate);
      
      return `
        <div class="inbox-chat-item ${activeClass}" onclick="selectInboxConversationByIndex(${index})">
          <img src="${c.listing.imageUrl || '/placeholder.png'}" class="chat-item-img" onerror="this.src='https://images.unsplash.com/photo-1531403009284-440f080d1e12?q=80&w=100&auto=format&fit=crop'">
          <div class="chat-item-details">
            <div class="chat-item-header">
              <span class="chat-item-user">${c.otherUser.name}</span>
              <span class="chat-item-date">${timeStr}</span>
            </div>
            <span class="chat-item-listing-title">${c.listing.title}</span>
            <span class="chat-item-msg-preview">${c.lastMessage}</span>
          </div>
          ${c.unreadCount > 0 ? '<span class="chat-item-unread-dot"></span>' : ''}
        </div>
      `;
    }).join('');

  } catch (err) {
    showToast('Failed to load inbox chats', 'error');
  }
}

// Select a chat conversation in Dashboard Inbox
async function selectInboxConversation(otherUser, listing) {
  state.currentInboxThread = { otherUser, listing };
  
  // Highlight selected item visually
  document.querySelectorAll('.inbox-chat-item').forEach(el => el.classList.remove('active'));
  
  const threadContainer = document.getElementById('inbox-thread-container');
  
  threadContainer.innerHTML = `
    <div class="chat-thread-header">
      <div class="chat-thread-title">
        <span class="chat-thread-user">${otherUser.name} (${otherUser.hostel || 'Hostel A'})</span>
        <span class="chat-thread-item">Listing: <strong>${listing.title}</strong> • ₹${listing.price}</span>
      </div>
    </div>
    <div class="chat-thread-body" id="inbox-thread-messages">
      <div style="padding:2rem; text-align:center; color:var(--text-secondary);"><i class="fa-solid fa-spinner fa-spin"></i> Loading messages...</div>
    </div>
    <form class="chat-thread-footer" id="inbox-chat-form">
      <input type="text" id="inbox-chat-input" placeholder="Type a message..." required autocomplete="off">
      <button type="submit" class="btn btn-primary"><i class="fa-solid fa-paper-plane"></i> Send</button>
    </form>
  `;
  
  document.getElementById('inbox-chat-form').addEventListener('submit', sendInboxMessage);

  await fetchInboxMessages();
  
  checkUnreadMessagesCount();
  loadInbox(true);
  
  stopChatPolling();
}

// Select a chat conversation in Dashboard Inbox by its index
function selectInboxConversationByIndex(index) {
  const c = state.conversations[index];
  if (c) {
    selectInboxConversation(c.otherUser, c.listing);
  }
}

// Fetch messages for active Dashboard inbox thread
async function fetchInboxMessages() {
  if (!state.currentInboxThread) return;
  const { otherUser, listing } = state.currentInboxThread;
  const msgBody = document.getElementById('inbox-thread-messages');
  if (!msgBody) return;

  try {
    const messages = await API.messages.getThread(otherUser._id || otherUser.id, listing._id || listing.id);
    
    const prevMsgCount = parseInt(msgBody.dataset.msgCount || '0');
    const newMsgCount = messages.length;

    if (messages.length === 0) {
      msgBody.innerHTML = `<div style="padding:2rem; text-align:center; color:var(--text-muted); font-size:0.85rem;">No messages in this chat thread. Type below to start!</div>`;
      msgBody.dataset.msgCount = '0';
      return;
    }

    const currentUserId = state.user.id;
    const isScrollAtBottom = msgBody.scrollHeight - msgBody.clientHeight <= msgBody.scrollTop + 50;

    msgBody.innerHTML = messages.map(m => {
      const isSent = (m.sender._id || m.sender.id || m.sender) === currentUserId;
      const bubbleClass = isSent ? 'chat-bubble-sent' : 'chat-bubble-received';
      const timeStr = new Date(m.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      
      return `
        <div class="chat-bubble ${bubbleClass}">
          <span>${m.content}</span>
          <span class="chat-bubble-date">${timeStr}</span>
        </div>
      `;
    }).join('');

    msgBody.dataset.msgCount = newMsgCount.toString();

    if (isScrollAtBottom || msgBody.dataset.firstLoad === undefined) {
      msgBody.scrollTop = msgBody.scrollHeight;
      msgBody.dataset.firstLoad = 'false';
    }

    if (newMsgCount > prevMsgCount) {
      checkUnreadMessagesCount();
      loadInbox(true);
    }

  } catch (err) {
    console.error('Error fetching messages:', err);
  }
}

// Send Message from Dashboard Inbox
async function sendInboxMessage(e) {
  e.preventDefault();
  if (!state.currentInboxThread) return;
  const { otherUser, listing } = state.currentInboxThread;
  const input = document.getElementById('inbox-chat-input');
  const text = input.value.trim();
  if (!text) return;

  try {
    await API.messages.send({
      receiver: otherUser._id || otherUser.id,
      listing: listing._id || listing.id,
      content: text
    });
    
    input.value = '';
    await fetchInboxMessages();
  } catch (err) {
    showToast('Failed to send message', 'error');
  }
}


// 2. Floating Quick Chat Box
async function openQuickChat(seller, listing) {
  const sellerId = seller._id || seller.id || seller;
  if (state.user && state.user.id === sellerId) {
    showToast("This is your listing!", "info");
    return;
  }

  const box = document.getElementById('quick-chat-box');
  box.style.display = 'flex';
  
  document.getElementById('quick-chat-user').textContent = seller.name || 'Seller';
  document.getElementById('quick-chat-item').textContent = listing.title;
  
  state.activeChatUser = seller;
  state.activeChatListing = listing;
  
  const container = document.getElementById('quick-chat-messages-container');
  container.innerHTML = `<div style="text-align:center; padding:2rem; color:var(--text-secondary);"><i class="fa-solid fa-spinner fa-spin"></i> Loading chat...</div>`;
  
  await fetchQuickChatMessages();
  
  checkUnreadMessagesCount();
  
  stopChatPolling();
}

async function fetchQuickChatMessages() {
  if (!state.activeChatUser || !state.activeChatListing) return;
  const msgContainer = document.getElementById('quick-chat-messages-container');
  if (!msgContainer) return;

  const targetUserId = state.activeChatUser._id || state.activeChatUser.id || state.activeChatUser;
  const listingId = state.activeChatListing._id || state.activeChatListing.id || state.activeChatListing;

  try {
    const messages = await API.messages.getThread(targetUserId, listingId);
    
    const prevMsgCount = parseInt(msgContainer.dataset.msgCount || '0');
    const newMsgCount = messages.length;

    if (messages.length === 0) {
      msgContainer.innerHTML = `<div style="padding:1rem; text-align:center; color:var(--text-muted); font-size:0.8rem;">Chat directly here. Ask questions, negotiate price, or arrange meeting spots!</div>`;
      msgContainer.dataset.msgCount = '0';
      return;
    }

    const currentUserId = state.user.id;
    const isScrollAtBottom = msgContainer.scrollHeight - msgContainer.clientHeight <= msgContainer.scrollTop + 50;

    msgContainer.innerHTML = messages.map(m => {
      const isSent = (m.sender._id || m.sender.id || m.sender) === currentUserId;
      const bubbleClass = isSent ? 'chat-bubble-sent' : 'chat-bubble-received';
      const timeStr = new Date(m.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      
      return `
        <div class="chat-bubble ${bubbleClass}" style="max-width:80%;">
          <span>${m.content}</span>
          <span class="chat-bubble-date">${timeStr}</span>
        </div>
      `;
    }).join('');

    msgContainer.dataset.msgCount = newMsgCount.toString();

    if (isScrollAtBottom || msgContainer.dataset.firstLoad === undefined) {
      msgContainer.scrollTop = msgContainer.scrollHeight;
      msgContainer.dataset.firstLoad = 'false';
    }

    if (newMsgCount > prevMsgCount) {
      checkUnreadMessagesCount();
    }
  } catch (err) {
    console.error('Error loading quick chat:', err);
  }
}

async function sendQuickChatMessage(e) {
  e.preventDefault();
  if (!state.activeChatUser || !state.activeChatListing) return;
  
  const input = document.getElementById('quick-chat-input');
  const text = input.value.trim();
  if (!text) return;

  const targetUserId = state.activeChatUser._id || state.activeChatUser.id || state.activeChatUser;
  const listingId = state.activeChatListing._id || state.activeChatListing.id || state.activeChatListing;

  try {
    await API.messages.send({
      receiver: targetUserId,
      listing: listingId,
      content: text
    });
    
    input.value = '';
    await fetchQuickChatMessages();
  } catch (err) {
    showToast('Failed to send message', 'error');
  }
}

function closeQuickChat() {
  document.getElementById('quick-chat-box').style.display = 'none';
  state.activeChatUser = null;
  state.activeChatListing = null;
  stopChatPolling();
}

// --- Application Bootstrapping ---
window.addEventListener('DOMContentLoaded', () => {
  // Setup elements
  updateNavbar();
  setView('home');
  setupEventListeners();
  
  // Start unread polling if logged in
  if (state.token) {
    startUnreadPolling();
    initSocket();
  }
  
  // Start carousel automation
  startCarousel();
});
