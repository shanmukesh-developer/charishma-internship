import Image from 'next/image';
import Link from 'next/link';
import Tilt from './Tilt';

const Hero = () => {
  return (
    <div className="relative min-h-screen bg-background flex flex-col items-center justify-between py-20 overflow-hidden">
      {/* Floating Food Decorations */}
      <div className="absolute top-12 -left-8 w-32 h-32 animate-float" style={{ animationDelay: '0s' }}>
        <Image 
          src="https://images.unsplash.com/photo-1565557623262-b51c2513a641?q=80&w=200&auto=format&fit=crop" 
          alt="biryani" 
          width={128}
          height={128}
          className="w-full h-full object-contain rotate-12" 
        />
      </div>
      <div className="absolute top-1/2 -right-12 w-44 h-44 animate-float" style={{ animationDelay: '1s' }}>
        <Image 
          src="https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?q=80&w=200&auto=format&fit=crop" 
          alt="dosa" 
          width={176}
          height={176}
          className="w-full h-full object-contain -rotate-45" 
        />
      </div>

      <div className="flex flex-col items-center w-full max-w-lg px-8">
        {/* Hero dish image with Legendary Tilt & Aura */}
        <div className="relative w-80 h-80 mb-16 group">
          {/* Stardust Aura */}
          <div className="absolute inset-[-40px] bg-[radial-gradient(circle_at_center,rgba(201,168,76,0.15)_0%,transparent_70%)] animate-pulse" />
          <div className="absolute inset-[-20px] border border-primary-yellow/10 rounded-full animate-[spin_20s_linear_infinite]" />
          
          <Tilt scale={1.05} transitionSpeed={2500}>
            <div className="relative w-80 h-80 rounded-full overflow-hidden border-4 border-primary-yellow/20 shadow-[0_0_50px_rgba(201,168,76,0.2)] group-hover:border-primary-yellow group-hover:shadow-[0_0_80px_rgba(201,168,76,0.4)] transition-all duration-700">
               <Image 
                src="https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?q=80&w=2070&auto=format&fit=crop" 
                alt="Delicious Food" 
                fill
                className="w-full h-full object-cover group-hover:scale-110 transition-transform [transition-duration:2000ms]"
              />
              <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
            </div>
          </Tilt>
        </div>

        <div className="text-center px-4">
          <p className="text-[11px] font-black text-primary-yellow uppercase tracking-[0.5em] mb-4 animate-fade-in">Now Live in Amaravathi 🌆</p>
          <h1 className="text-[48px] md:text-[56px] leading-[1] font-extrabold mb-8 tracking-tighter" style={{ fontFamily: "'Syne', sans-serif" }}>
            <span className="text-white light:text-gray-900">Your city,</span><br />
            <span className="text-gold-shimmer block mt-2">your cravings.</span>
          </h1>
          <p className="text-secondary-text text-[15px] font-medium leading-relaxed mb-12 max-w-[320px] mx-auto opacity-80">
            Explore premium restaurants across Amaravathi. <br />
            Mission-critical speed. Zero friction.
          </p>
          
          <Link href="/restaurants" className="btn-yellow">
            EXPLORE RESTAURANTS
          </Link>
        </div>
      </div>

      {/* Slide Indicators */}
      <div className="w-full px-12 flex justify-start items-center space-x-2.5">
         <div className="w-10 h-1.5 bg-primary-yellow rounded-full" />
         <div className="w-1.5 h-1.5 bg-white/20 rounded-full" />
         <div className="w-1.5 h-1.5 bg-white/20 rounded-full" />
      </div>
    </div>
  );
};

export default Hero;
