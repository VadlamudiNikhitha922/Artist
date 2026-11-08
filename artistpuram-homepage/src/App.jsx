import React, { useEffect, useState } from 'react';
import { registerCustomer, signInCustomer, signOut } from './services/auth';
import { supabase } from './lib/supabase';
import { Instagram, Mail, Phone, ArrowUpRight, Heart, Menu, X, Sparkles, ChevronRight, UserRound, Eye, EyeOff, LockKeyhole, LogIn, UserPlus, Users, CalendarDays, Plus, Trash2, CheckCircle2, Settings2 } from 'lucide-react';

const artwork = [
  {
    name: 'Resin Art',
    tag: 'Colour, captured',
    image: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?auto=format&fit=crop&w=900&q=85',
    alt: 'Colourful abstract art with layered textures'
  },
  {
    name: 'Crochet Art',
    tag: 'Loops of love',
    image: 'https://images.unsplash.com/photo-1610701596007-11502861dcfa?auto=format&fit=crop&w=900&q=85',
    alt: 'Handcrafted textile and yarn art'
  },
  {
    name: 'Pipe Cleaner Art',
    tag: 'Little happy things',
    image: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=900&q=85',
    alt: 'Bright flowers arranged in a creative display'
  },
  {
    name: 'Lippan Art',
    tag: 'Tradition in detail',
    image: 'https://images.unsplash.com/photo-1577083552431-6e5fd01aa342?auto=format&fit=crop&w=900&q=85',
    alt: 'Decorative handcrafted wall art'
  },
  {
    name: 'Tote Bag Painting',
    tag: 'Art you can carry',
    image: 'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=900&q=85',
    alt: 'Creative stationery and everyday accessories'
  }
];

const initialBookings = [
  'Custom art bookings — enquire for availability',
  'Personalised gifts — booking status to be updated',
  'Creative workshops — upcoming dates to be announced'
];

const WORKSHOPS_KEY = 'artistpuram_workshops_v1';
const USERS_KEY = 'artistpuram_registered_users_v1';
const BOOKINGS_KEY = 'artistpuram_workshop_bookings_v1';
const OWNER_HANDLE = '@artistpuram';
const OWNER_EMAIL = 'artistpuram.admin@gmail.com';

const defaultWorkshops = artwork.map((item, index) => ({
  id: `workshop-${index + 1}`,
  name: item.name,
  // Owner must set the price and explicitly open each workshop.
  price: null,
  capacity: [12, 10, 12, 8, 10][index] || 10,
  open: false,
  date: ''
}));

function readLocalList(key, fallback) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || 'null');
    return Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalList(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Unable to save ${key}`, error);
  }
}

function mapWorkshopRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    price: row.price,
    capacity: row.capacity,
    date: row.workshop_date ? String(row.workshop_date).slice(0, 10) : '',
    open: Boolean(row.booking_open),
  };
}

async function fetchWorkshops({ openOnly = false } = {}) {
  let query = supabase.from('workshops').select('*').order('created_at', { ascending: true });
  if (openOnly) query = query.eq('booking_open', true);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(mapWorkshopRow);
}

function workshopToDatabase(workshop) {
  return {
    name: workshop.name,
    description: workshop.description || '',
    price: workshop.price === '' || workshop.price === null ? null : Number(workshop.price),
    capacity: Math.max(1, Number(workshop.capacity) || 1),
    workshop_date: workshop.date ? `${workshop.date}T12:00:00.000Z` : null,
    booking_open: Boolean(workshop.open),
  };
}

function loadRazorpayCheckout() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error('Razorpay Checkout could not be loaded. Please check your internet connection and try again.'));
    document.body.appendChild(script);
  });
}

function BookingPage({ onBack }) {
  const [workshops, setWorkshops] = useState([]);
  const [loadingWorkshops, setLoadingWorkshops] = useState(true);
  const [workshopError, setWorkshopError] = useState('');
  const [paymentMessage, setPaymentMessage] = useState('');
  const [paymentMessageType, setPaymentMessageType] = useState('info');
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: '',
    age: '',
    gender: '',
    place: '',
    workshop: '',
    payment: 'razorpay'
  });

  useEffect(() => {
    let active = true;
    fetchWorkshops({ openOnly: true })
      .then((rows) => { if (active) { setWorkshops(rows.filter((item) => item.price !== null && item.price !== undefined)); setWorkshopError(''); } })
      .catch((error) => { console.error('Unable to load workshops:', error); if (active) setWorkshopError(error.message || 'Unable to load workshops.'); })
      .finally(() => { if (active) setLoadingWorkshops(false); });
    return () => { active = false; };
  }, []);

  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    const selectedWorkshop = workshops.find((item) => item.id === form.workshop);
    if (!selectedWorkshop) {
      setPaymentMessageType('error');
      setPaymentMessage('This workshop is not currently available. Please choose another option.');
      return;
    }

    setSubmitting(true);
    setPaymentMessage('');
    try {
      // Load Checkout before creating an order, so a script-loading failure
      // does not leave an unnecessary pending booking in the database.
      await loadRazorpayCheckout();

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const user = userData?.user;
      if (!user) throw new Error('Please sign in before booking a workshop.');

      const { data: orderData, error: orderError } = await supabase.functions.invoke(
        'create-razorpay-order',
        {
          body: {
            workshop_id: selectedWorkshop.id,
            customer_name: form.name.trim(),
            age: Number(form.age),
            gender: form.gender,
            city: form.place.trim()
          }
        }
      );

      if (orderError) throw orderError;
      if (!orderData?.success || !orderData?.order_id || !orderData?.key_id) {
        throw new Error(orderData?.error || 'Unable to create the Razorpay order. Please try again.');
      }

      const checkout = new window.Razorpay({
        key: orderData.key_id,
        amount: orderData.amount,
        currency: orderData.currency || 'INR',
        name: 'ArtistPuram',
        description: selectedWorkshop.name,
        order_id: orderData.order_id,
        prefill: {
          name: form.name.trim(),
          email: user.email || ''
        },
        theme: { color: '#493b32' },
        modal: {
          ondismiss: () => {
            setPaymentMessageType('info');
            setPaymentMessage('Checkout was closed. No successful payment was confirmed. If you try again, a new payment order may be created.');
          }
        },
        handler: async (response) => {
          setPaymentMessageType('info');
          setPaymentMessage('Payment received. Verifying your payment securely…');
          try {
            const { data: verifyData, error: verifyError } = await supabase.functions.invoke(
              'verify-razorpay-payment',
              {
                body: {
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature
                }
              }
            );

            if (verifyError) throw verifyError;
            if (!verifyData?.success) {
              throw new Error(verifyData?.error || 'Payment verification could not be completed.');
            }

            setPaymentMessageType('success');
            setPaymentMessage('Payment successful! Your workshop booking is confirmed.');
          } catch (verificationError) {
            console.error('Razorpay payment verification failed:', verificationError);
            setPaymentMessageType('error');
            setPaymentMessage(`Payment was submitted, but confirmation could not be completed: ${verificationError.message || 'Please contact ArtistPuram with your payment ID.'}`);
          }
        }
      });

      checkout.on('payment.failed', (response) => {
        console.error('Razorpay payment failed:', response?.error);
        setPaymentMessageType('error');
        setPaymentMessage(response?.error?.description || 'Payment failed. Please try again.');
      });

      checkout.open();
    } catch (error) {
      console.error('Unable to start Razorpay checkout:', error);
      setPaymentMessageType('error');
      setPaymentMessage(error?.message || 'Unable to start checkout. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="booking-page" style={{ minHeight: '75vh', padding: '56px 20px 80px', background: '#faf7f2' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <button type="button" onClick={onBack} style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: '8px 0', marginBottom: 18, color: '#5d5148' }}>
          ← Back to Artistpuram
        </button>
        <div style={{ background: '#fff', borderRadius: 22, padding: 'clamp(22px, 5vw, 42px)', boxShadow: '0 12px 40px rgba(65,45,30,.08)' }}>
          <div className="eyebrow"><span className="eyebrow-line" /> YOUR CREATIVE EXPERIENCE</div>
          <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.2rem)', lineHeight: 1.1, margin: '14px 0' }}>Book a <em>workshop.</em></h1>
          <p style={{ color: '#756a61', lineHeight: 1.7, marginBottom: 8 }}>Tell us a little about yourself and choose an available workshop. Prices and seat counts are managed by the owner.</p><p style={{ color: '#756a61', fontSize: 13, marginBottom: 28 }}>Workshop host: <strong>{OWNER_HANDLE}</strong></p>

          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 18 }}>
              <label style={fieldStyle}>Full name *
                <input name="name" value={form.name} onChange={updateField} required autoComplete="name" placeholder="Enter your full name" style={inputStyle} />
              </label>

              <label style={fieldStyle}>Age *
                <input name="age" type="number" min="1" max="120" value={form.age} onChange={updateField} required placeholder="Your age" style={inputStyle} />
              </label>

              <label style={fieldStyle}>Gender *
                <select name="gender" value={form.gender} onChange={updateField} required style={inputStyle}>
                  <option value="">Select gender</option>
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                  <option value="Non-binary">Non-binary</option>
                  <option value="Prefer not to say">Prefer not to say</option>
                </select>
              </label>

              <label style={fieldStyle}>City / place you are coming from *
                <input name="place" value={form.place} onChange={updateField} required autoComplete="address-level2" placeholder="Enter your city or place" style={inputStyle} />
              </label>

              <label style={{ ...fieldStyle, gridColumn: '1 / -1' }}>Workshop / art activity *
                <select name="workshop" value={form.workshop} onChange={updateField} required style={inputStyle} disabled={loadingWorkshops || workshops.length === 0}>
                  <option value="">{loadingWorkshops ? 'Loading workshops…' : 'Choose a workshop'}</option>
                  {workshops.map((item) => (
                    <option key={item.id} value={item.id}>{item.name} — ₹{Number(item.price).toLocaleString('en-IN')}</option>
                  ))}
                </select>
                {workshopError && <small style={{ color: '#9b3026' }}>{workshopError}</small>}
                {!loadingWorkshops && !workshopError && workshops.length === 0 && <small style={{ color: '#756a61' }}>No workshops are currently open for booking.</small>}
              </label>

              <section style={{ gridColumn: '1 / -1', border: '1px solid #e8ded4', borderRadius: 12, padding: 18, background: '#fffdfb' }}>
                <div style={{ fontWeight: 650, color: '#40362f', marginBottom: 8 }}>Secure payment with Razorpay</div>
                <p style={{ margin: '0 0 8px', color: '#756a61', lineHeight: 1.6 }}>
                  Workshop amount: <strong>₹{Number(workshops.find((item) => item.id === form.workshop)?.price || 0).toLocaleString('en-IN')}</strong>.
                </p>
                <p style={{ margin: 0, color: '#756a61', fontSize: 13, lineHeight: 1.6 }}>
                  You will be able to complete payment through the payment methods enabled in Razorpay Checkout. Payment confirmation will be handled automatically by the secure backend integration.
                </p>
                <small style={{ display: 'block', marginTop: 10, color: '#9b6a37', lineHeight: 1.6 }}>
                  Razorpay Test Mode checkout is connected. Use test credentials while testing; do not use live payment details until the full flow has been verified.
                </small>
              </section>
            </div>

            <p style={{ fontSize: 13, color: '#756a61', lineHeight: 1.6 }}>Please note: the owner's cancellation and refund policy will be shown before final payment.</p>
            {paymentMessage && (
              <div role="status" aria-live="polite" style={{ marginTop: 14, borderRadius: 10, padding: 13, background: paymentMessageType === 'error' ? '#fff0ee' : paymentMessageType === 'success' ? '#eaf7ed' : '#fff4e8', color: paymentMessageType === 'error' ? '#9b3026' : paymentMessageType === 'success' ? '#256b38' : '#684b30', fontSize: 13, lineHeight: 1.6 }}>
                {paymentMessage}
              </div>
            )}
            <button type="submit" disabled={submitting || loadingWorkshops || workshops.length === 0} className="button button-dark" style={{ border: 0, cursor: submitting ? 'wait' : 'pointer', marginTop: 12, minHeight: 48, opacity: submitting ? 0.7 : 1 }}>
              {submitting ? 'Starting secure checkout…' : 'Pay securely with Razorpay'} <ArrowUpRight size={17} />
            </button>
          </form>

        </div>
      </div>
    </main>
  );
}


function AuthPage({ onBack, onSignedIn }) {
  const [mode, setMode] = useState('signin');
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('info');

  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setMessage('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setMessage('');

    const email = form.email.trim().toLowerCase();

    if (mode === 'signup' && form.password !== form.confirmPassword) {
      setMessageType('error');
      setMessage('Your passwords do not match. Please check and try again.');
      return;
    }

    if (form.password.length < 8) {
      setMessageType('error');
      setMessage('Please use a password with at least 8 characters.');
      return;
    }

    try {
      if (mode === 'signup') {
        const data = await registerCustomer({
          fullName: form.name.trim(),
          email,
          password: form.password,
        });

        setMessageType('success');
        if (data?.user && !data?.session) {
          setMessage('Your account was created. Please check your email and confirm your address before signing in.');
        } else if (data?.user && data?.session) {
          setMessage('Account created successfully. You are now signed in.');
          onSignedIn?.(data.user);
        } else {
          setMessage('Registration request submitted. If email confirmation is enabled, check your inbox.');
        }
      } else {
        const data = await signInCustomer({ email, password: form.password });
        setMessageType('success');
        setMessage('Login successful.');
        onSignedIn?.(data?.user);
      }
    } catch (error) {
      console.error('Supabase authentication error:', error);
      setMessageType('error');
      setMessage(error?.message || 'Authentication failed. Please try again.');
    }
  };

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setMessage('');
    setShowPassword(false);
  };

  return (
    <main style={{ minHeight: '76vh', padding: '46px 18px 76px', background: '#faf7f2' }}>
      <div style={{ maxWidth: 1020, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 26, alignItems: 'stretch' }}>
        <section style={{ borderRadius: 24, padding: 'clamp(28px, 5vw, 48px)', background: '#493b32', color: '#fffaf4', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 390 }}>
          <div>
            <button type="button" onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: 0, background: 'transparent', color: 'inherit', padding: 0, cursor: 'pointer', marginBottom: 34 }}>
              ← Back to Artistpuram
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
              <Sparkles size={25} />
              <span style={{ fontSize: 19, letterSpacing: '.02em', fontWeight: 650 }}>artistpuram.</span>
            </div>
            <p style={{ textTransform: 'uppercase', letterSpacing: '.16em', fontSize: 11, opacity: .75, marginBottom: 12 }}>Your creative corner</p>
            <h1 style={{ fontSize: 'clamp(2.4rem, 5vw, 3.7rem)', lineHeight: 1.04, fontWeight: 500, margin: '0 0 20px' }}>
              Make room<br />for <em>creativity.</em>
            </h1>
            <p style={{ maxWidth: 360, color: '#e7dcd1', lineHeight: 1.8, margin: 0 }}>
              Sign in to keep your workshop journey together, or create an account to get started with Artistpuram.
            </p>
          </div>
          <p style={{ color: '#e7dcd1', fontSize: 13, margin: '38px 0 0' }}>Handmade with intention. Shared with heart. ♥</p>
        </section>

        <section style={{ background: '#fff', border: '1px solid #eee5dc', borderRadius: 24, padding: 'clamp(24px, 5vw, 42px)', boxShadow: '0 12px 40px rgba(65,45,30,.06)' }}>
          <div style={{ display: 'flex', gap: 8, padding: 5, borderRadius: 12, background: '#f7f2ed', marginBottom: 28 }}>
            <button type="button" onClick={() => switchMode('signin')} style={{ flex: 1, minHeight: 44, border: 0, borderRadius: 9, cursor: 'pointer', font: 'inherit', fontWeight: 650, background: mode === 'signin' ? '#fff' : 'transparent', color: '#40362f', boxShadow: mode === 'signin' ? '0 2px 8px rgba(50,30,20,.07)' : 'none' }}>
              <LogIn size={16} style={{ verticalAlign: 'middle', marginRight: 7 }} /> Sign in
            </button>
            <button type="button" onClick={() => switchMode('signup')} style={{ flex: 1, minHeight: 44, border: 0, borderRadius: 9, cursor: 'pointer', font: 'inherit', fontWeight: 650, background: mode === 'signup' ? '#fff' : 'transparent', color: '#40362f', boxShadow: mode === 'signup' ? '0 2px 8px rgba(50,30,20,.07)' : 'none' }}>
              <UserPlus size={16} style={{ verticalAlign: 'middle', marginRight: 7 }} /> Create account
            </button>
          </div>

          <div className="eyebrow"><span className="eyebrow-line" /> {mode === 'signup' ? 'JOIN OUR COMMUNITY' : 'WELCOME BACK'}</div>
          <h2 style={{ fontSize: 'clamp(1.9rem, 4vw, 2.5rem)', lineHeight: 1.15, margin: '12px 0 10px', color: '#342a24' }}>
            {mode === 'signup' ? 'Create your account.' : 'Good to see you.'}
          </h2>
          <p style={{ color: '#756a61', lineHeight: 1.65, margin: '0 0 24px' }}>
            {mode === 'signup' ? 'A few details and you’ll be ready to explore.' : 'Enter your details to continue your creative journey.'}
          </p>

          <form onSubmit={handleSubmit}>
            {mode === 'signup' && (
              <label style={{ ...fieldStyle, marginBottom: 16 }}>
                Full name
                <input name="name" value={form.name} onChange={updateField} required autoComplete="name" placeholder="Your full name" style={inputStyle} />
              </label>
            )}
            <label style={{ ...fieldStyle, marginBottom: 16 }}>
              Email address
              <input name="email" type="email" value={form.email} onChange={updateField} required autoComplete="email" placeholder="you@example.com" style={inputStyle} />
            </label>
            <label style={{ ...fieldStyle, marginBottom: 16 }}>
              Password
              <span style={{ position: 'relative', display: 'block' }}>
                <LockKeyhole size={17} style={{ position: 'absolute', left: 13, top: 15, color: '#8c7c70' }} />
                <input name="password" type={showPassword ? 'text' : 'password'} value={form.password} onChange={updateField} required minLength={8} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder="At least 8 characters" style={{ ...inputStyle, paddingLeft: 40, paddingRight: 46 }} />
                <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)} style={{ position: 'absolute', right: 8, top: 5, width: 36, height: 36, display: 'grid', placeItems: 'center', border: 0, borderRadius: 8, background: 'transparent', color: '#756a61', cursor: 'pointer' }}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
            {mode === 'signup' && (
              <label style={{ ...fieldStyle, marginBottom: 18 }}>
                Confirm password
                <input name="confirmPassword" type="password" value={form.confirmPassword} onChange={updateField} required minLength={8} autoComplete="new-password" placeholder="Enter your password again" style={inputStyle} />
              </label>
            )}
            {mode === 'signin' && (
              <p style={{ margin: '-3px 0 18px', fontSize: 12, color: '#756a61' }}>Forgot your password? Password reset can be enabled when authentication is connected.</p>
            )}
            <button type="submit" className="button button-dark" style={{ width: '100%', justifyContent: 'center', minHeight: 48, border: 0, cursor: 'pointer' }}>
              {mode === 'signup' ? 'Create account' : 'Sign in'} <ArrowUpRight size={17} />
            </button>
          </form>

          {message && (
            <div role="status" aria-live="polite" style={{ marginTop: 18, borderRadius: 12, padding: 14, background: messageType === 'error' ? '#fff0ee' : messageType === 'success' ? '#eaf7ed' : '#fff4e8', color: messageType === 'error' ? '#9b3026' : messageType === 'success' ? '#256b38' : '#684b30', lineHeight: 1.6, fontSize: 13 }}>
              {message}
            </div>
          )}

          <p style={{ margin: '22px 0 0', textAlign: 'center', fontSize: 13, color: '#756a61' }}>
            {mode === 'signup' ? 'Already have an account? ' : 'New to Artistpuram? '}
            <button type="button" onClick={() => switchMode(mode === 'signup' ? 'signin' : 'signup')} style={{ border: 0, background: 'transparent', color: '#493b32', font: 'inherit', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>
              {mode === 'signup' ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        </section>
      </div>
    </main>
  );
}


function OwnerAuthPage({ mode = 'signin', onBack, onNavigate, onSignedIn }) {
  const [form, setForm] = useState({ name: '', email: OWNER_EMAIL, password: '', confirmPassword: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('info');
  const [busy, setBusy] = useState(false);

  const setNotice = (type, text) => {
    setMessageType(type);
    setMessage(text);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setMessage('');
    const email = form.email.trim().toLowerCase();

    if (mode !== 'reset' && email !== OWNER_EMAIL) {
      setNotice('error', `Owner access is restricted to ${OWNER_EMAIL}.`);
      return;
    }

    if ((mode === 'signup' || mode === 'reset') && form.password !== form.confirmPassword) {
      setNotice('error', 'Passwords do not match.');
      return;
    }

    if ((mode === 'signup' || mode === 'reset') && form.password.length < 8) {
      setNotice('error', 'Use a password with at least 8 characters.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: OWNER_EMAIL,
          password: form.password,
          options: {
            data: { full_name: form.name.trim(), account_type: 'owner' },
            emailRedirectTo: `${window.location.origin}/owner-login`,
          },
        });
        if (error) throw error;

        if (data?.session && data?.user) {
          setNotice('success', 'Owner account created. Opening the dashboard…');
          onSignedIn?.();
        } else {
          setNotice('success', 'Registration submitted. Check the owner email inbox and confirm the email before signing in.');
        }
      } else if (mode === 'signin') {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: OWNER_EMAIL,
          password: form.password,
        });
        if (error) throw error;
        if (data?.user?.email?.toLowerCase() !== OWNER_EMAIL) {
          await supabase.auth.signOut();
          throw new Error('This account is not authorized as the Artistpuram owner.');
        }
        setNotice('success', 'Login successful. Opening the owner dashboard…');
        onSignedIn?.();
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(OWNER_EMAIL, {
          redirectTo: `${window.location.origin}/owner-reset-password`,
        });
        if (error) throw error;
        setNotice('success', `If an account exists for ${OWNER_EMAIL}, a password reset link will be sent to that inbox.`);
      } else if (mode === 'reset') {
        const { data, error } = await supabase.auth.updateUser({ password: form.password });
        if (error) throw error;
        if (!data?.user) throw new Error('The reset session is missing. Please request a new reset link.');
        setNotice('success', 'Password updated successfully. You can now sign in with your new password.');
        setForm({ name: '', email: OWNER_EMAIL, password: '', confirmPassword: '' });
      }
    } catch (error) {
      console.error('Owner authentication error:', error);
      setNotice('error', error?.message || 'Unable to complete this request. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'signup' ? 'Create owner account' :
    mode === 'forgot' ? 'Reset owner password' :
    mode === 'reset' ? 'Set a new password' : 'Owner sign in';
  const description = mode === 'signup'
    ? 'Register the authorized Artistpuram owner account for the first time.'
    : mode === 'forgot'
      ? 'We will send a password reset link to the authorized owner email.'
      : mode === 'reset'
        ? 'Choose a new password for the owner account.'
        : 'Sign in to manage workshops, prices, bookings and availability.';

  return (
    <main style={{ minHeight: '76vh', padding: '46px 18px 76px', background: '#faf7f2' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', background: '#fff', border: '1px solid #eee5dc', borderRadius: 24, padding: 'clamp(24px, 5vw, 42px)', boxShadow: '0 12px 40px rgba(65,45,30,.06)' }}>
        <button type="button" onClick={onBack} style={{ border: 0, background: 'transparent', color: '#5d5148', padding: '8px 0', marginBottom: 20, cursor: 'pointer' }}>← Back to Artistpuram</button>
        <div className="eyebrow"><span className="eyebrow-line" /> PRIVATE OWNER AREA</div>
        <h1 style={{ fontSize: 'clamp(2rem, 5vw, 2.8rem)', lineHeight: 1.1, margin: '14px 0 10px', color: '#342a24' }}>{title}</h1>
        <p style={{ color: '#756a61', lineHeight: 1.65, marginBottom: 24 }}>{description}</p>
        {mode !== 'reset' && (
          <div style={{ padding: 12, background: '#f7f2ed', borderRadius: 10, color: '#493b32', fontSize: 13, marginBottom: 20 }}>
            Authorized owner email: <strong>{OWNER_EMAIL}</strong>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
          {mode === 'signup' && (
            <label style={fieldStyle}>Owner full name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoComplete="name" placeholder="Enter owner name" style={inputStyle} />
            </label>
          )}
          {mode !== 'reset' && (
            <label style={fieldStyle}>Owner email
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required readOnly style={{ ...inputStyle, background: '#f7f2ed' }} />
            </label>
          )}
          {mode !== 'forgot' && (
            <label style={fieldStyle}>{mode === 'reset' ? 'New password' : 'Password'}
              <span style={{ position: 'relative', display: 'block' }}>
                <LockKeyhole size={17} style={{ position: 'absolute', left: 13, top: 15, color: '#8c7c70' }} />
                <input type={showPassword ? 'text' : 'password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} placeholder="At least 8 characters" style={{ ...inputStyle, paddingLeft: 40, paddingRight: 46 }} />
                <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)} style={{ position: 'absolute', right: 8, top: 5, width: 36, height: 36, display: 'grid', placeItems: 'center', border: 0, borderRadius: 8, background: 'transparent', color: '#756a61', cursor: 'pointer' }}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
          )}
          {(mode === 'signup' || mode === 'reset') && (
            <label style={fieldStyle}>Confirm password
              <input type="password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} required minLength={8} autoComplete="new-password" placeholder="Enter password again" style={inputStyle} />
            </label>
          )}
          <button type="submit" disabled={busy} className="button button-dark" style={{ width: '100%', justifyContent: 'center', minHeight: 48, border: 0, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Please wait…' : mode === 'signup' ? 'Register owner account' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Update password' : 'Sign in to dashboard'}
            <ArrowUpRight size={17} />
          </button>
        </form>

        {message && (
          <div role="status" aria-live="polite" style={{ marginTop: 18, borderRadius: 12, padding: 14, background: messageType === 'error' ? '#fff0ee' : messageType === 'success' ? '#eaf7ed' : '#fff4e8', color: messageType === 'error' ? '#9b3026' : messageType === 'success' ? '#256b38' : '#684b30', lineHeight: 1.6, fontSize: 13 }}>
            {message}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px 16px', marginTop: 22, fontSize: 13 }}>
          {mode === 'signin' && <>
            <button type="button" onClick={() => onNavigate('/owner-forgot-password')} style={textButtonStyle}>Forgot password?</button>
            <button type="button" onClick={() => onNavigate('/owner-register')} style={textButtonStyle}>First time? Register</button>
          </>}
          {mode === 'signup' && <button type="button" onClick={() => onNavigate('/owner-login')} style={textButtonStyle}>Already registered? Sign in</button>}
          {mode === 'forgot' && <button type="button" onClick={() => onNavigate('/owner-login')} style={textButtonStyle}>Back to owner login</button>}
          {mode === 'reset' && <button type="button" onClick={() => onNavigate('/owner-login')} style={textButtonStyle}>Go to owner login</button>}
        </div>
      </div>
    </main>
  );
}

const textButtonStyle = { border: 0, background: 'transparent', color: '#493b32', font: 'inherit', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', padding: 4 };

function OwnerPage({ onBack }) {
  const [workshops, setWorkshops] = useState([]);
  const [users, setUsers] = useState(() => readLocalList(USERS_KEY, []));
  const [bookings, setBookings] = useState(() => readLocalList(BOOKINGS_KEY, []));
  const [newWorkshop, setNewWorkshop] = useState({ name: '', description: '', price: '', capacity: '10', date: '' });
  const [tab, setTab] = useState('workshops');
  const [notice, setNotice] = useState('Loading workshops from Supabase…');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadWorkshops = async () => {
    setLoading(true);
    try {
      const rows = await fetchWorkshops();
      setWorkshops(rows);
      setNotice(rows.length ? 'Workshops loaded from Supabase.' : 'No workshops in Supabase yet. Add your first workshop below.');
    } catch (error) {
      console.error('Unable to load workshops:', error);
      setNotice(`Could not load workshops: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadWorkshops(); }, []);

  const seatsBooked = (workshop) => bookings.filter((booking) => booking.workshopId === workshop.id && booking.status !== 'Cancelled').length;

  const addWorkshop = async (event) => {
    event.preventDefault();
    const name = newWorkshop.name.trim();
    if (!name || newWorkshop.price === '' || !Number.isFinite(Number(newWorkshop.price)) || Number(newWorkshop.price) < 0) {
      setNotice('Enter a workshop name and a valid price.');
      return;
    }
    if (workshops.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      setNotice('A workshop with this name already exists.');
      return;
    }
    setSaving(true);
    try {
      const payload = workshopToDatabase({ ...newWorkshop, name, open: false });
      const { data, error } = await supabase.from('workshops').insert(payload).select('*').single();
      if (error) throw error;
      setWorkshops((current) => [...current, mapWorkshopRow(data)]);
      setNewWorkshop({ name: '', description: '', price: '', capacity: '10', date: '' });
      setNotice('Workshop added successfully to Supabase. It is closed for booking until you open it.');
    } catch (error) {
      console.error('Unable to add workshop:', error);
      setNotice(`Unable to add workshop: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const changeWorkshopDraft = (id, changes) => {
    setWorkshops((items) => items.map((item) => item.id === id ? { ...item, ...changes } : item));
  };

  const saveWorkshop = async (id, overrideChanges = {}) => {
    const current = workshops.find((item) => item.id === id);
    if (!current) return;
    const next = { ...current, ...overrideChanges };
    if (next.open && (next.price === null || next.price === undefined || next.price === '')) {
      setNotice('Set a price before opening this workshop.');
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.from('workshops').update(workshopToDatabase(next)).eq('id', id).select('*').single();
      if (error) throw error;
      setWorkshops((items) => items.map((item) => item.id === id ? mapWorkshopRow(data) : item));
      setNotice('Workshop updated in Supabase.');
    } catch (error) {
      console.error('Unable to update workshop:', error);
      setNotice(`Unable to update workshop: ${error.message}`);
      await loadWorkshops();
    } finally {
      setSaving(false);
    }
  };

  const deleteWorkshop = async (workshop) => {
    if (!window.confirm(`Delete ${workshop.name}? Existing registrations, if any, will not be deleted automatically.`)) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('workshops').delete().eq('id', workshop.id);
      if (error) throw error;
      setWorkshops((items) => items.filter((item) => item.id !== workshop.id));
      setNotice('Workshop deleted from Supabase.');
    } catch (error) {
      console.error('Unable to delete workshop:', error);
      setNotice(`Unable to delete workshop: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const updateBookingStatus = (id, status) => {
    const next = bookings.map((booking) => booking.id === id ? { ...booking, status } : booking);
    setBookings(next);
    writeLocalList(BOOKINGS_KEY, next);
    setNotice('This prototype booking status was updated in this browser only. Supabase booking management is not connected yet.');
  };

  const refresh = async () => {
    await loadWorkshops();
    setUsers(readLocalList(USERS_KEY, []));
    setBookings(readLocalList(BOOKINGS_KEY, []));
  };

  return (
    <main style={{ minHeight: '75vh', padding: '38px 18px 76px', background: '#faf7f2' }}>
      <div style={{ maxWidth: 1160, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginBottom: 24 }}>
          <div><div className="eyebrow"><span className="eyebrow-line" /> OWNER HANDLE · {OWNER_HANDLE}</div><h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.2rem)', margin: '12px 0 5px', color: '#342a24' }}>Owner dashboard</h1><p style={{ margin: 0, color: '#756a61' }}>Manage workshops, availability, registered users and booking requests.</p></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button type="button" onClick={refresh} disabled={saving} style={secondaryButton}>↻ Refresh</button><button type="button" onClick={onBack} style={secondaryButton}>← View website</button></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 24 }}>
          {[[<Settings2 size={18}/>, 'Workshop options', workshops.length], [<Users size={18}/>, 'Registered users', users.length], [<CalendarDays size={18}/>, 'Booking requests', bookings.length], [<CheckCircle2 size={18}/>, 'Open workshops', workshops.filter((item) => item.open).length]].map(([icon, label, value]) => <div key={label} style={statCard}><div style={{ color: '#8a6b50', display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>{icon}{label}</div><strong style={{ display: 'block', fontSize: 30, marginTop: 10, color: '#342a24' }}>{value}</strong></div>)}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
          {[['workshops', 'Workshops & availability'], ['bookings', 'Workshop registrations'], ['users', 'Registered users']].map(([value, label]) => <button key={value} type="button" onClick={() => setTab(value)} style={{ ...secondaryButton, background: tab === value ? '#493b32' : '#fff', color: tab === value ? '#fffaf4' : '#493b32' }}>{label}</button>)}
        </div>
        {notice && <p role="status" style={{ background: '#fff4e8', padding: 12, borderRadius: 10, color: '#684b30' }}>{notice}</p>}
        {tab === 'workshops' && <>
          <section style={panelStyle}><h2 style={{ marginTop: 0 }}>Add a workshop</h2><form onSubmit={addWorkshop} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, alignItems: 'end' }}>
            <label style={fieldStyle}>Workshop name<input required value={newWorkshop.name} onChange={(e) => setNewWorkshop({ ...newWorkshop, name: e.target.value })} placeholder="e.g. Clay Art" style={inputStyle}/></label>
            <label style={fieldStyle}>Description<input value={newWorkshop.description} onChange={(e) => setNewWorkshop({ ...newWorkshop, description: e.target.value })} placeholder="Short workshop details" style={inputStyle}/></label>
            <label style={fieldStyle}>Price (₹)<input required type="number" min="0" step="1" value={newWorkshop.price} onChange={(e) => setNewWorkshop({ ...newWorkshop, price: e.target.value })} style={inputStyle}/></label>
            <label style={fieldStyle}>Total seats<input required type="number" min="1" value={newWorkshop.capacity} onChange={(e) => setNewWorkshop({ ...newWorkshop, capacity: e.target.value })} style={inputStyle}/></label>
            <label style={fieldStyle}>Workshop date<input type="date" value={newWorkshop.date} onChange={(e) => setNewWorkshop({ ...newWorkshop, date: e.target.value })} style={inputStyle}/></label>
            <button type="submit" disabled={saving} className="button button-dark" style={{ minHeight: 44, border: 0, justifyContent: 'center', opacity: saving ? .7 : 1 }}><Plus size={16}/> {saving ? 'Saving…' : 'Add workshop'}</button>
          </form></section>
          <section style={panelStyle}><h2 style={{ marginTop: 0 }}>Current workshops</h2>
            {loading ? <p>Loading workshops…</p> : workshops.length === 0 ? <p>No workshops in Supabase yet. Add your first workshop above.</p> : <div style={{ display: 'grid', gap: 12 }}>{workshops.map((item) => { const remaining = Math.max(0, Number(item.capacity) - seatsBooked(item)); return <article key={item.id} style={{ border: '1px solid #eee5dc', borderRadius: 14, padding: 16, display: 'grid', gridTemplateColumns: 'minmax(180px, 1.5fr) repeat(auto-fit, minmax(115px, 1fr))', gap: 12, alignItems: 'end' }}>
              <div><strong style={{ display: 'block', color: '#342a24', fontSize: 16 }}>{item.name}</strong><small style={{ color: '#756a61' }}>{item.date || 'Date to be announced'} · {seatsBooked(item)} registrations shown in this browser · {remaining} estimated seats left</small></div>
              <label style={fieldStyle}>Price (₹)<input type="number" min="0" step="1" value={item.price ?? ''} disabled={saving} onChange={(e) => changeWorkshopDraft(item.id, { price: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })} onBlur={() => saveWorkshop(item.id)} style={inputStyle}/></label>
              <label style={fieldStyle}>Seat capacity<input type="number" min={1} value={item.capacity} disabled={saving} onChange={(e) => changeWorkshopDraft(item.id, { capacity: Math.max(1, Number(e.target.value) || 1) })} onBlur={() => saveWorkshop(item.id)} style={inputStyle}/></label>
              <label style={fieldStyle}>Date<input type="date" value={item.date || ''} disabled={saving} onChange={(e) => changeWorkshopDraft(item.id, { date: e.target.value })} onBlur={() => saveWorkshop(item.id)} style={inputStyle}/></label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 42, fontSize: 13, fontWeight: 600 }}><input type="checkbox" checked={Boolean(item.open)} disabled={saving || (item.price === null || item.price === undefined || item.price === '')} onChange={(e) => { changeWorkshopDraft(item.id, { open: e.target.checked }); saveWorkshop(item.id, { open: e.target.checked }); }}/> Open for booking</label>
              <button type="button" disabled={saving} aria-label={`Delete ${item.name}`} onClick={() => deleteWorkshop(item)} style={{ ...secondaryButton, color: '#9b3026', opacity: saving ? .7 : 1 }}><Trash2 size={15}/> Delete</button>
            </article>; })}</div>}
          </section>
        </>}
        {tab === 'bookings' && <section style={panelStyle}><h2 style={{ marginTop: 0 }}>Workshop registrations</h2><p>Bookings are not connected to Supabase yet. This section currently shows only older browser-local demo records.</p>{bookings.length === 0 ? <p>No browser-local registrations found.</p> : <div style={{ overflowX: 'auto' }}><table style={tableStyle}><thead><tr>{['Reference', 'Customer', 'Age / Gender', 'Place', 'Workshop', 'Price', 'Payment method', 'Razorpay payment ID', 'Status', 'Update status'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead><tbody>{bookings.map((b) => <tr key={b.id}><td style={tdStyle}>{b.id}</td><td style={tdStyle}>{b.name}</td><td style={tdStyle}>{b.age} / {b.gender}</td><td style={tdStyle}>{b.place}</td><td style={tdStyle}>{b.workshop}</td><td style={tdStyle}>₹{Number(b.price || 0).toLocaleString('en-IN')}</td><td style={tdStyle}>{b.payment === 'razorpay' || b.payment === 'online' ? 'Razorpay' : 'Not selected'}</td><td style={tdStyle}>{b.razorpayPaymentId || '—'}</td><td style={tdStyle}>{b.status}</td><td style={tdStyle}><select value={b.status} onChange={(e) => updateBookingStatus(b.id, e.target.value)} style={{ ...inputStyle, minWidth: 180 }}><option>Payment verification pending</option><option>Payment verified - confirmed</option><option>Awaiting owner confirmation</option><option>Payment pending</option><option>Confirmed</option><option>Cancelled</option></select></td></tr>)}</tbody></table></div>}</section>}
        {tab === 'users' && <section style={panelStyle}><h2 style={{ marginTop: 0 }}>Registered users</h2><p>Customer profile listing is not connected to the Supabase profiles table yet.</p>{users.length === 0 ? <p>No browser-local registration profiles found.</p> : <div style={{ overflowX: 'auto' }}><table style={tableStyle}><thead><tr>{['Name', 'Email', 'Registration date'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead><tbody>{users.map((user) => <tr key={user.id}><td style={tdStyle}>{user.name}</td><td style={tdStyle}>{user.email}</td><td style={tdStyle}>{new Date(user.registeredAt).toLocaleString()}</td></tr>)}</tbody></table></div>}</section>}
        <p style={{ color: '#756a61', fontSize: 12, lineHeight: 1.7, marginTop: 18 }}>Workshop details are now saved in Supabase. Customer bookings, registered-user listing and Razorpay payment verification are separate steps and are not connected yet.</p>
      </div>
    </main>
  );
}

const secondaryButton = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 42, border: '1px solid #e4d8cd', borderRadius: 10, background: '#fff', color: '#493b32', padding: '9px 13px', font: 'inherit', fontSize: 13, cursor: 'pointer' };
const statCard = { border: '1px solid #eee5dc', borderRadius: 16, background: '#fff', padding: 18 };
const panelStyle = { background: '#fff', border: '1px solid #eee5dc', borderRadius: 18, padding: 'clamp(18px, 3vw, 28px)', marginBottom: 18, boxShadow: '0 8px 28px rgba(65,45,30,.04)' };
const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' };
const thStyle = { padding: '12px 10px', borderBottom: '1px solid #e7ded5', color: '#756a61', whiteSpace: 'nowrap' };
const tdStyle = { padding: '12px 10px', borderBottom: '1px solid #f0e9e2', color: '#40362f', verticalAlign: 'top' };

const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14, fontWeight: 600, color: '#40362f' };
const inputStyle = { width: '100%', minHeight: 46, boxSizing: 'border-box', border: '1px solid #ddd2c7', borderRadius: 10, padding: '11px 12px', background: '#fff', color: '#2f2924', font: 'inherit', fontWeight: 400 };

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  // The public ticker is populated asynchronously from Supabase below.
  // Start empty; getWorkshops() was part of the old localStorage implementation.
  const [currentOpenBookings, setCurrentOpenBookings] = useState([]);

  useEffect(() => {
    const handlePopState = () => setCurrentPath(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Load the public booking ticker from Supabase so all visitors see the same open workshops.
  useEffect(() => {
    let active = true;
    const refreshOpenBookings = async () => {
      try {
        const rows = await fetchWorkshops({ openOnly: true });
        if (active) setCurrentOpenBookings(rows.map((workshop) =>
          `${workshop.name} — ₹${Number(workshop.price).toLocaleString('en-IN')}${workshop.date ? ` · ${workshop.date}` : ''} · Bookings open now`
        ));
      } catch (error) {
        console.error('Unable to refresh public workshop ticker:', error);
      }
    };
    refreshOpenBookings();
    const intervalId = window.setInterval(refreshOpenBookings, 15000);
    return () => { active = false; window.clearInterval(intervalId); };
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.error('Unable to read session:', error.message);
      if (mounted) {
        setCurrentUser(data?.session?.user ?? null);
        setAuthLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const navigateTo = (path) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (currentPath.replace(/\/$/, '') === '/login' || currentPath.replace(/\/$/, '') === '/register') {
    return <AuthPage onBack={() => navigateTo('/')} onSignedIn={() => navigateTo('/')} />;
  }

  const normalizedPath = currentPath.replace(/\/$/, '') || '/';

  if (normalizedPath === '/owner-login' || normalizedPath === '/owner-register' ||
      normalizedPath === '/owner-forgot-password' || normalizedPath === '/owner-reset-password') {
    const ownerMode = normalizedPath === '/owner-register' ? 'signup'
      : normalizedPath === '/owner-forgot-password' ? 'forgot'
      : normalizedPath === '/owner-reset-password' ? 'reset' : 'signin';
    return <OwnerAuthPage
      mode={ownerMode}
      onBack={() => navigateTo('/')}
      onNavigate={navigateTo}
      onSignedIn={() => navigateTo('/owner')}
    />;
  }

  if (normalizedPath === '/owner') {
    if (authLoading) return <main style={{ padding: 40, background: '#faf7f2' }}>Checking owner access…</main>;
    if (!currentUser || currentUser.email?.toLowerCase() !== OWNER_EMAIL) {
      return <OwnerAuthPage
        mode="signin"
        onBack={() => navigateTo('/')}
        onNavigate={navigateTo}
        onSignedIn={() => navigateTo('/owner')}
      />;
    }
    return <OwnerPage onBack={() => navigateTo('/')} />;
  }

  if (currentPath.replace(/\/$/, '') === '/booking') {
    if (authLoading) return <main style={{ padding: 40, background: '#faf7f2' }}>Checking your sign-in…</main>;
    if (!currentUser) {
      return <AuthPage onBack={() => navigateTo('/')} onSignedIn={() => navigateTo('/booking')} />;
    }
    return <BookingPage onBack={() => navigateTo('/')} />;
  }

  const fullName = currentUser?.user_metadata?.full_name || currentUser?.email?.split('@')[0] || '';
  const firstName = fullName.trim().split(/\s+/)[0] || 'Profile';

  const handleProfileClick = (event) => {
    event.preventDefault();
    if (!currentUser) {
      navigateTo('/login');
      return;
    }
    setProfileOpen((open) => !open);
  };

  const handleLogout = async () => {
    try {
      await signOut();
      setProfileOpen(false);
      navigateTo('/');
    } catch (error) {
      console.error('Logout failed:', error);
      window.alert(error?.message || 'Unable to sign out. Please try again.');
    }
  };

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="site-shell">
      <div className="announcement">
        <span className="announcement-label"><span className="live-dot" /> BOOKING BOARD</span>
        <div className="ticker-window" aria-label="Current booking updates">
          <div className="ticker-track">
            {(currentOpenBookings.length ? [...currentOpenBookings, ...currentOpenBookings] : ['No workshops are currently open for booking', 'Check back soon for upcoming workshops']).map((item, i) => (
              <span className="ticker-item" key={`${item}-${i}`}>{item}<span className="ticker-star">✳</span></span>
            ))}
          </div>
        </div>
      </div>

      <header className="header">
        <a className="brand" href="#home" aria-label="Artistpuram home">
          <span className="brand-mark"><Sparkles size={22} strokeWidth={1.7} /></span>
          <span className="brand-word">artistpuram<span className="brand-period">.</span><small>ART • HANDMADE • HEART</small></span>
        </a>
        <button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation">
          {menuOpen ? <X /> : <Menu />}
        </button>
        <nav className={menuOpen ? 'nav nav-open' : 'nav'}>
          <a href="#home" onClick={closeMenu}>Home</a>
          <a href="#creations" onClick={closeMenu}>Our art</a>
          <a href="#note" onClick={closeMenu}>A note from Artist</a>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <a href={currentUser ? '#profile' : '/login'} onClick={handleProfileClick} aria-label={currentUser ? `Profile for ${firstName}` : 'User sign in or register'} title={currentUser ? firstName : 'Sign in / Register'} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, textDecoration: 'none' }}>
              <UserRound size={18} />
              {currentUser && <span style={{ fontSize: 13, fontWeight: 600 }}>{firstName}</span>}
            </a>
            {currentUser && profileOpen && (
              <div style={{ position: 'absolute', top: 'calc(100% + 12px)', right: 0, zIndex: 100, minWidth: 220, padding: 16, background: '#fff', border: '1px solid #eee5dc', borderRadius: 12, boxShadow: '0 10px 30px rgba(40,25,15,.12)' }}>
                <strong style={{ display: 'block', color: '#342a24' }}>{firstName}</strong>
                <span style={{ display: 'block', margin: '5px 0 14px', fontSize: 12, color: '#756a61', overflowWrap: 'anywhere' }}>{currentUser.email}</span>
                <button type="button" onClick={handleLogout} style={{ ...secondaryButton, width: '100%' }}>Sign out</button>
              </div>
            )}
          </div>
          <a className="nav-cta" href="/booking" onClick={(event) => { event.preventDefault(); if (authLoading) return; navigateTo(currentUser ? '/booking' : '/login'); }}>Booking<ArrowUpRight size={15} /></a>
        </nav>
      </header>

      <main>
        <section className="hero" id="home">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> A little corner of creativity</div>
            <h1>Made by hand.<br /><em>Kept by heart.</em></h1>
            <p className="hero-description">A home for thoughtful handmade art, one-of-a-kind gifts, and little things that make ordinary days feel special.</p>
            <div className="hero-actions">
              <a className="button button-dark" href="#creations">Explore our art <ArrowUpRight size={17} /></a>
              <a className="text-link" href="#note">Meet the artist <ChevronRight size={16} /></a>
            </div>
            <div className="hero-footnote"><span className="tiny-heart">♥</span> Made slowly, with lots of love.</div>
          </div>
          <div className="hero-art">
            <div className="hero-image-frame">
              <img src="https://images.unsplash.com/photo-1452860606245-08befc0ff44b?auto=format&fit=crop&w=1200&q=90" alt="Artist's desk with art supplies and creative work" />
            </div>
            <div className="hero-sticker"><span>ART IS</span><strong>JOY</strong><span>IN THE MAKING ✳</span></div>
            <div className="hero-caption"><span className="caption-line" /> Little pieces of imagination, made real.</div>
          </div>
          <div className="hero-scribble" aria-hidden="true">✳</div>
        </section>

        <section className="intro-strip">
          <span>HANDMADE WITH INTENTION</span><span className="strip-flower">✿</span>
          <span>CREATED WITH LOVE</span><span className="strip-flower">✿</span>
          <span>MADE TO MAKE YOU SMILE</span>
        </section>

        <section className="creations section-pad" id="creations">
          <div className="section-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> A peek into our world</div>
              <h2>Little things.<br /><em>Lots of meaning.</em></h2>
            </div>
            <p className="section-intro">From playful textures to traditional details, every art form has its own kind of magic. Here are a few things we love making.</p>
          </div>

          <div className="art-grid">
            {artwork.map((item, index) => (
              <article className={`art-card art-card-${index + 1}`} key={item.name}>
                <div className="art-image-wrap">
                  <img src={item.image} alt={item.alt} loading="lazy" />
                  <span className="art-number">0{index + 1}</span>
                  <span className="art-heart"><Heart size={17} /></span>
                </div>
                <div className="art-card-info">
                  <div><h3>{item.name}</h3><p>{item.tag}</p></div>
                  <span className="art-arrow"><ArrowUpRight size={19} /></span>
                </div>
              </article>
            ))}
          </div>
          <p className="sample-note">A small preview of the kinds of art we make. Photos and collections can be replaced with the artist's own work later.</p>
        </section>

        <section className="artist-note section-pad" id="note">
          <div className="note-decoration" aria-hidden="true">“</div>
          <div className="note-content">
            <div className="eyebrow eyebrow-light"><span className="eyebrow-line" /> A note from the artist</div>
            <h2>Every piece has<br />a <em>little piece of me.</em></h2>
            <p>Artistpuram is a space for creating with curiosity, celebrating handmade things, and turning simple ideas into something meaningful. Thank you for being here and supporting art made with heart.</p>
            <div className="signature">With love, <span>the Artistpuram artist</span> <span className="signature-heart">♥</span></div>
          </div>
          <div className="note-side">
            <img src="https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&w=900&q=85" alt="Paints and art supplies on a creative work table" loading="lazy" />
            <span className="note-side-caption">A little colour goes a long way.</span>
          </div>
        </section>

        <section className="contact-section section-pad" id="contact">
          <div className="contact-top">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> Have an idea in mind?</div>
              <h2>Let's make<br /><em>something lovely.</em></h2>
            </div>
            <p>Have a custom idea, a question about bookings, or just want to say hello? We'd love to hear from you.</p>
          </div>
          <div className="contact-cards">
            <a className="contact-card" href="mailto:artistpuram@gmail.com">
              <span className="contact-icon"><Mail size={21} /></span>
              <span><small>WRITE TO US</small><strong>artistpuram@gmail.com</strong></span>
              <ArrowUpRight className="contact-arrow" size={19} />
            </a>
            <a className="contact-card" href="tel:+919603155497">
              <span className="contact-icon"><Phone size={21} /></span>
              <span><small>CALL THE ARTIST</small><strong>+91 96031 55497</strong></span>
              <ArrowUpRight className="contact-arrow" size={19} />
            </a>
            <a className="contact-card" href="https://www.instagram.com/artistpuram/" target="_blank" rel="noopener noreferrer">
              <span className="contact-icon"><Instagram size={21} /></span>
              <span><small>FOLLOW THE JOURNEY</small><strong>@artistpuram</strong></span>
              <ArrowUpRight className="contact-arrow" size={19} />
            </a>
          </div>
          <p className="contact-disclaimer">For workshop enquiries, contact the Artistpuram owner by phone, email, or Instagram.</p>
        </section>
      </main>

      <footer className="footer" id="footer">
        <div className="footer-main">
          <a className="brand brand-footer" href="#home">
            <span className="brand-mark"><Sparkles size={22} strokeWidth={1.7} /></span>
            <span className="brand-word">artistpuram<span className="brand-period">.</span><small>ART • HANDMADE • HEART</small></span>
          </a>
          <p>A little more art.<br />A little more heart.</p>
          <div className="footer-links">
            <a href="#privacy">Privacy policy</a>
            <a href="#contact">Contact us</a>
            <a href="#help">Help</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Artistpuram. Made with <span className="footer-heart">♥</span>.</span>
          <span>Every creation tells a story.</span>
        </div>
        <div className="placeholder-footnotes" aria-label="Pages to complete later">
          <span id="privacy">Privacy policy page to be added</span>
          <span id="help">Help page to be added</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
