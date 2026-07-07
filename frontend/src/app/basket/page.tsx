"use client";
import { useState, useEffect, useRef } from 'react';
import { useCart } from '@/context/CartContext';
import { summarizeCustomizations } from '@/components/CustomizeDrawer';
import Link from 'next/link';
import SafeImage from '@/components/SafeImage';
import Tilt from '@/components/Tilt';
import Magnetic from '@/components/Magnetic';
import socket from '@/utils/socket';

interface CartItem {
  id: string;
  cartKey: string;
  name: string;
  price: number;
  basePrice?: number;
  image?: string;
  imageUrl?: string;
  restaurantName?: string;
  restaurantId: string;
  quantity: number;
  isCake?: boolean;
  customName?: string;
  customizations?: Record<string, any>;
  addedBy?: string;
  addedById?: string;
}

interface BasketItemProps {
  item: CartItem;
  updateQuantity: (cartKey: string, q: number) => void;
  removeFromCart: (cartKey: string) => void;
  updateCustomName: (cartKey: string, name: string) => void;
}

function BasketItem({ item, updateQuantity, removeFromCart, updateCustomName }: BasketItemProps) {
  const [localName, setLocalName] = useState(item.customizations?.cakeMessage || item.customName || '');
  const key = item.cartKey || item.id;
  const summary = summarizeCustomizations(item.customizations);

  const handleNameChange = (val: string) => {
    setLocalName(val);
    updateCustomName(key, val);
  };

  return (
    <div className="flex flex-col bg-card-bg p-4 md:p-6 rounded-[28px] md:rounded-[35px] border border-white/5 light:border-black transition-all hover:border-white/10 light:border-black group">
      <div className="flex gap-4 md:gap-6 items-center">
        <div className="w-24 h-24 relative flex-shrink-0">
          <SafeImage 
            src={item.image || item.imageUrl} 
            alt={item.name} 
            fill
            className="rounded-full border-2 border-primary-yellow shadow-2xl" 
          />
        </div>
        <div className="flex-1">
          <h3 className="font-black text-base text-white light:text-black group-hover:text-primary-yellow transition-colors">{item.name}</h3>
          <p className="text-secondary-text text-xs mt-0.5 mb-1">from {item.restaurantName || "Zenvy Elite"}</p>

          {/* Customization summary */}
          {summary && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {summary.split(' • ').map((part, i) => (
                <span key={i} className="text-[9px] font-bold bg-[#38BDF8]/10 text-[#38BDF8]/70 px-2 py-0.5 rounded-lg border border-[#38BDF8]/10">
                  {part}
                </span>
              ))}
            </div>
          )}

          {item.addedBy && (
            <div className="flex items-center gap-1.5 mb-3">
              <span className="w-4 h-4 bg-primary-yellow/20 text-primary-yellow rounded-full flex items-center justify-center text-[8px]">👤</span>
              <span className="text-[10px] text-white light:text-black font-bold uppercase tracking-wider">Added by <span className="text-white light:text-black">{item.addedBy}</span></span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <p className="text-primary-yellow font-black text-lg">₹{item.price}</p>
              {item.basePrice && item.price !== item.basePrice && (
                <p className="text-[10px] text-white light:text-black light:text-black line-through">₹{item.basePrice}</p>
              )}
            </div>
            <div className="flex items-center gap-4 bg-white/5 light:bg-black px-4 py-2 rounded-full border border-white/5 light:border-black">
              <button onClick={() => updateQuantity(key, item.quantity - 1)} className="w-6 h-6 flex items-center justify-center font-bold text-secondary-text hover:text-white light:text-black">-</button>
              <span className="font-black text-sm w-4 text-center">{item.quantity}</span>
              <button onClick={() => updateQuantity(key, item.quantity + 1)} className="w-6 h-6 flex items-center justify-center font-bold text-secondary-text hover:text-white light:text-black">+</button>
            </div>
          </div>
        </div>
        <button onClick={() => removeFromCart(key)} className="p-2 opacity-20 hover:opacity-100 hover:text-red-500 transition-all">
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </div>

      {/* Cake message input */}
      {item.customizations?.cakeMessage !== undefined && (
        <div className="mt-5 pt-5 border-t border-white/5 light:border-black">
          <label className="text-[10px] font-black uppercase tracking-widest text-primary-yellow/60 block mb-3">Message on Cake</label>
          <div className="relative">
            <input 
              type="text"
              placeholder="e.g. Happy Birthday Shanmukh"
              value={localName}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-full stardust-search rounded-2xl px-5 py-4 text-sm font-black text-white light:text-black placeholder:text-white light:text-black focus:outline-none transition-all"
            />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-primary-yellow ">✍️</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BasketPage() {
  const { 
    cart, updateQuantity, removeFromCart, updateCustomName, 
    totalPrice, uniqueRestaurants, deliveryFee, setCart,
    roomCode, isHosting, isJoined, handleHostRoom, handleJoinRoom, handleDisconnect 
  } = useCart();

  const [inputCode, setInputCode] = useState('');
  const [isJoinOpen, setIsJoinOpen] = useState(false);
  const [alertMsg, setAlertMsg] = useState('');
  const [userName, setUserName] = useState('Someone');

  // F6: Group Poll State
  const [poll, setPoll] = useState<{
    id: string; question: string; options: string[]; votes: Record<string, number>;
    createdBy: string; winnerOption?: string; hasVoted?: boolean;
  } | null>(null);
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [newPollQuestion, setNewPollQuestion] = useState('Where should we order from?');
  const [newPollOptions, setNewPollOptions] = useState('Zenvy Picks, Spicy Kitchen, Burger Hub');

  useEffect(() => {
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        setUserName(JSON.parse(stored).name || 'Someone');
      }
    } catch {}

    socket.on('poll_started', (p) => {
      setPoll({ ...p, hasVoted: false });
      setShowPollCreator(false);
    });

    socket.on('poll_vote_update', (data) => {
      setPoll((prev) => {
        if (!prev || prev.id !== data.pollId) return prev;
        const v = { ...prev.votes };
        v[data.optionIndex] = (v[data.optionIndex] || 0) + 1;
        return { ...prev, votes: v };
      });
    });

    socket.on('poll_ended', (data) => {
      setPoll((prev) => {
        if (!prev || prev.id !== data.pollId) return prev;
        return { ...prev, winnerOption: data.winnerOption };
      });
    });

    return () => {
      socket.off('poll_started');
      socket.off('poll_vote_update');
      socket.off('poll_ended');
    };
  }, []);

  const handleCreatePoll = () => {
    if (!roomCode) return;
    socket.emit('poll_create', {
      roomCode,
      question: newPollQuestion,
      options: newPollOptions.split(',').map(s => s.trim()).filter(Boolean)
    });
  };

  const handleVote = (index: number) => {
    if (!poll || poll.hasVoted || !roomCode) return;
    socket.emit('poll_vote', {
      roomCode,
      pollId: poll.id,
      optionIndex: index,
      voterName: userName
    });
    setPoll({ ...poll, hasVoted: true });
  };

  const onJoinSubmit = () => {
    handleJoinRoom(inputCode);
    setIsJoinOpen(false);
  };
  
  const onDisconnect = () => {
    handleDisconnect();
    setInputCode('');
  };

  // Group items by user who added them
  const groupedByUser = cart.reduce<Record<string, { items: CartItem[] }>>((acc, item) => {
    const userKey = item.addedBy || 'Guest Roommate';
    if (!acc[userKey]) acc[userKey] = { items: [] };
    acc[userKey].items.push(item as CartItem);
    return acc;
  }, {});

  const grandTotal = totalPrice + deliveryFee;

  return (
    <main className="min-h-screen bg-[#0A0A0B] light:bg-[#f8f8fa] text-white light:text-black p-4 md:p-8 relative overflow-x-hidden">
      {/* Cinematic Background */}
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(201,168,76,0.05)_0%,transparent_50%)] pointer-events-none" />
      <div className="fixed inset-0 bg-gradient-to-b from-black via-transparent to-black pointer-events-none " />

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-8">
          <Magnetic>
            <Link href="/" className="w-12 h-12 bg-white/5 light:bg-black backdrop-blur-xl rounded-full flex items-center justify-center border border-white/10 light:border-black hover:bg-white/10 transition-all">
              <svg className="w-5 h-5 text-white light:text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
          </Magnetic>
          <h1 className="text-xl font-black uppercase tracking-[0.3em] text-gold-shimmer">My Basket</h1>
          <div className="w-12" />
        </div>

        {/* Roommate Multiplayer Cart Hub */}
        <div className="mb-8 glass-card p-5 md:p-6 border-white/5 light:border-black rounded-[30px] bg-black/40 backdrop-blur-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
            <span className="text-5xl font-black italic">ROOM</span>
          </div>

          {!roomCode ? (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-black text-primary-yellow uppercase tracking-widest mb-1">Roommate Group Cart</p>
                <h4 className="text-xs font-black text-white light:text-black uppercase tracking-wider">Order together with your roommates and split the bill</h4>
              </div>
              <div className="flex gap-3 w-full sm:w-auto">
                <button
                  onClick={handleHostRoom}
                  className="flex-1 sm:flex-none px-5 py-2.5 bg-white/5 light:bg-black hover:bg-white/10 border border-white/10 light:border-black rounded-xl text-[10px] font-black uppercase tracking-wider text-white light:text-black transition-all"
                >
                  📡 Host Cart
                </button>
                <button
                  onClick={() => setIsJoinOpen(true)}
                  className="flex-1 sm:flex-none px-5 py-2.5 bg-primary-yellow text-black hover:bg-primary-yellow/90 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                >
                  👥 Join Cart
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-full flex items-center justify-center text-sm animate-pulse">
                  🟢
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">Live Room Active</p>
                    <span className="text-[8px] px-2 py-0.5 bg-white/5 light:bg-black rounded-full text-white light:text-black uppercase font-black">
                      {isHosting ? 'Host' : 'Joined'}
                    </span>
                  </div>
                  <h4 className="text-sm font-black text-white light:text-black uppercase tracking-widest mt-0.5">
                    Room Code: <span className="text-primary-yellow font-black text-base">{roomCode}</span>
                  </h4>
                </div>
              </div>
              <button
                onClick={onDisconnect}
                className="w-full sm:w-auto px-5 py-2.5 bg-red-500/10 hover:bg-red-500/25 border border-red-500/20 text-red-500 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
              >
                🚫 Disconnect
              </button>
            </div>
          )}

          {isJoinOpen && !roomCode && (
            <div className="mt-5 pt-5 border-t border-white/5 light:border-black animate-in slide-in-from-top-3 duration-300">
              <label className="text-[9px] font-black uppercase tracking-wider text-primary-yellow block mb-2">Enter Roommate Code</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. ZN-8B2A"
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value)}
                  className="flex-1 stardust-search rounded-xl px-4 py-3 text-xs font-black text-white light:text-black placeholder:text-white light:text-black focus:outline-none transition-all uppercase"
                />
                <button
                  onClick={onJoinSubmit}
                  className="px-6 bg-white text-black hover:bg-white/90 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                >
                  Connect
                </button>
              </div>
            </div>
          )}

          {/* ── F6: Group Poll UI ── */}
          {roomCode && (
            <div className="mt-5 pt-5 border-t border-white/5 light:border-black">
              {!poll && !showPollCreator && (
                <button
                  onClick={() => setShowPollCreator(true)}
                  className="w-full py-3 bg-white/5 light:bg-black border border-white/10 light:border-black rounded-xl text-[10px] font-black uppercase tracking-widest text-primary-yellow hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                >
                  <span>📊</span> Start a Group Poll
                </button>
              )}

              {showPollCreator && !poll && (
                <div className="animate-in slide-in-from-top-2">
                  <input
                    type="text"
                    value={newPollQuestion}
                    onChange={e => setNewPollQuestion(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 light:border-black rounded-xl px-4 py-3 mb-2 text-sm text-white light:text-black"
                    placeholder="Question (e.g. What to eat?)"
                  />
                  <input
                    type="text"
                    value={newPollOptions}
                    onChange={e => setNewPollOptions(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 light:border-black rounded-xl px-4 py-3 mb-3 text-sm text-white light:text-black"
                    placeholder="Comma separated options"
                  />
                  <div className="flex gap-2">
                    <button onClick={handleCreatePoll} className="flex-1 py-3 bg-primary-yellow text-black rounded-xl text-[10px] font-black uppercase tracking-widest">Post Poll</button>
                    <button onClick={() => setShowPollCreator(false)} className="flex-1 py-3 bg-white/5 light:bg-black text-white light:text-black rounded-xl text-[10px] font-black uppercase tracking-widest">Cancel</button>
                  </div>
                </div>
              )}

              {poll && (
                <div className="bg-white/5 light:bg-black border border-white/10 light:border-black rounded-2xl p-4 animate-in fade-in">
                  <h4 className="text-sm font-black text-white light:text-black mb-3 flex items-center justify-between">
                    <span>📊 {poll.question}</span>
                    {poll.winnerOption && <span className="text-[9px] bg-primary-yellow text-black px-2 py-0.5 rounded-full uppercase tracking-widest">Finished</span>}
                  </h4>
                  <div className="space-y-2">
                    {poll.options.map((opt, i) => {
                      const votes = poll.votes[i] || 0;
                      const isWinner = poll.winnerOption === opt;
                      return (
                        <button
                          key={i}
                          onClick={() => handleVote(i)}
                          disabled={poll.hasVoted || !!poll.winnerOption}
                          className={`w-full relative overflow-hidden rounded-xl border p-3 flex justify-between items-center transition-all ${isWinner ? 'border-primary-yellow bg-primary-yellow/10' : 'border-white/10 light:border-black bg-black/20 hover:bg-black/40'}`}
                        >
                          <span className="relative z-10 text-sm font-bold">{opt}</span>
                          <span className="relative z-10 text-xs font-black">{votes} {votes === 1 ? 'vote' : 'votes'}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {cart.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-32 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div className="w-full flex justify-center mb-10">
               <div className="w-40 h-40 bg-white/5 light:bg-black rounded-full flex items-center justify-center text-6xl shadow-2xl border border-white/5 light:border-black">🛒</div>
            </div>
            <p className="text-secondary-text font-black uppercase tracking-widest mb-12 ">Your basket is currently empty</p>
            <Magnetic>
              <Link href="/" className="px-12 py-4 bg-primary-yellow text-black rounded-2xl font-black uppercase tracking-widest text-xs shadow-[0_15px_30px_-10px_rgba(201,168,76,0.3)]">Explore Canteens</Link>
            </Magnetic>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
              {/* Group by restaurant */}
              {/* Group by user */}
              {Object.entries(groupedByUser).map(([userName, group]) => (
                <div key={userName} className="mb-6">
                  <h2 className="text-xs font-black uppercase tracking-[0.2em] text-white light:text-black mb-4 px-2 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-white/5 light:bg-black flex items-center justify-center text-white light:text-black">👤</span>
                    {userName}'s Items
                  </h2>
                  <div className="space-y-4">
                    {group.items.map((item) => (
                      <Tilt key={item.cartKey || item.id} scale={1.01} className="mb-4">
                        <BasketItem 
                          key={item.cartKey || item.id} 
                          item={item} 
                          updateQuantity={updateQuantity}
                          removeFromCart={removeFromCart}
                          updateCustomName={updateCustomName}
                        />
                      </Tilt>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-12 space-y-4 animate-in fade-in duration-1000 delay-300">
               <div className="flex justify-between items-center text-xs font-black uppercase tracking-widest text-white light:text-black">
                 <span>Items Subtotal</span>
                 <span>₹{totalPrice}</span>
               </div>
               <div className="flex justify-between items-center text-xs font-black uppercase tracking-widest text-white light:text-black">
                 <span className="flex items-center gap-2">
                   Delivery Fee
                   {uniqueRestaurants > 1 && (
                     <span className="text-[9px] normal-case tracking-normal text-[#38BDF8]/40 font-bold">
                       ({uniqueRestaurants} restaurants × ₹30)
                     </span>
                   )}
                 </span>
                 <span>₹{deliveryFee}</span>
               </div>
               <div className="h-[1px] bg-white/5 light:bg-black" />
               <div className="flex justify-between items-center text-white light:text-black text-2xl md:text-3xl font-black tracking-tighter">
                 <span className="text-gold-shimmer uppercase text-[10px] md:text-base tracking-widest">Grand Total</span>
                 <span className="text-primary-yellow">₹{grandTotal}</span>
               </div>
            </div>

            <Magnetic>
              <Link href="/checkout" className="w-full btn-yellow mt-12 flex justify-center py-6 text-[13px] font-black uppercase tracking-[0.2em] relative overflow-hidden group shadow-[0_20px_50px_rgba(201,168,76,0.25)]">
                <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-12" />
                Proceed to Checkout
              </Link>
            </Magnetic>
          </div>
        )}
      </div>
    </main>
  );
}
