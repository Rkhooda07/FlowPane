/* FlowPane Landing Page — Main JS
   Scroll animations, navbar behavior, mobile menu */

(function () {
  'use strict';

  // =========================================================================
  // DOM ELEMENTS
  // =========================================================================

  const navbar = document.getElementById('navbar');
  const menuBtn = document.getElementById('menu-btn');
  const drawer = document.getElementById('navbar-drawer');
  const backdrop = document.getElementById('navbar-backdrop');
  const heroScroll = document.querySelector('.hero__scroll');
  const revealElements = document.querySelectorAll('.reveal');

  // =========================================================================
  // SCROLL HANDLING
  // =========================================================================

  let ticking = false;
  let lastScrollY = window.scrollY;

  function onScroll() {
    lastScrollY = window.scrollY;

    if (!ticking) {
      window.requestAnimationFrame(() => {
        updateNavbar();
        updateHeroScroll();
        ticking = false;
      });
      ticking = true;
    }
  }

  function updateNavbar() {
    if (lastScrollY > 20) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  }

  function updateHeroScroll() {
    const hero = document.querySelector('.hero');
    if (!hero) return;

    const heroHeight = hero.offsetHeight;
    const scrollProgress = lastScrollY / (heroHeight * 0.5);

    if (heroScroll) {
      if (scrollProgress > 0.3) {
        heroScroll.style.opacity = Math.max(0, 1 - scrollProgress);
      } else {
        heroScroll.style.opacity = 1;
      }
    }
  }

  // =========================================================================
  // INTERSECTION OBSERVER FOR REVEAL ANIMATIONS
  // =========================================================================

  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      });
    },
    {
      rootMargin: '0px 0px -10% 0px',
      threshold: 0.1
    }
  );

  revealElements.forEach((el) => {
    revealObserver.observe(el);
  });

  // =========================================================================
  // MOBILE MENU
  // =========================================================================

  function openMenu() {
    menuBtn.setAttribute('aria-expanded', 'true');
    drawer.classList.add('open');
    backdrop.classList.add('visible');
    document.body.style.overflow = 'hidden';
  }

  function closeMenu() {
    menuBtn.setAttribute('aria-expanded', 'false');
    drawer.classList.remove('open');
    backdrop.classList.remove('visible');
    document.body.style.overflow = '';
  }

  function toggleMenu() {
    if (menuBtn.getAttribute('aria-expanded') === 'true') {
      closeMenu();
    } else {
      openMenu();
    }
  }

  if (menuBtn && drawer && backdrop) {
    menuBtn.addEventListener('click', toggleMenu);
    backdrop.addEventListener('click', closeMenu);

    // Close on link click
    drawer.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', closeMenu);
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.classList.contains('open')) {
        closeMenu();
      }
    });
  }

  // =========================================================================
  // SMOOTH SCROLL FOR ANCHOR LINKS
  // =========================================================================

  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;

      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        const navHeight = navbar.offsetHeight;
        const targetPosition = target.getBoundingClientRect().top + window.scrollY - navHeight;

        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });
      }
    });
  });

  // =========================================================================
  // PARALLAX EFFECT ON HERO MOCKUP (subtle)
  // =========================================================================

  const mockup = document.getElementById('app-mockup');
  if (mockup) {
    window.addEventListener('mousemove', (e) => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      const rect = mockup.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const deltaX = (e.clientX - centerX) / 30;
      const deltaY = (e.clientY - centerY) / 30;

      mockup.style.transform = `perspective(1000px) rotateY(${-3 + deltaX * 0.5}deg) rotateX(${2 + deltaY * 0.5}deg)`;
    });

    window.addEventListener('mouseleave', () => {
      mockup.style.transform = 'perspective(1000px) rotateY(-3deg) rotateX(2deg)';
    });
  }

  // =========================================================================
  // DOWNLOAD BUTTON CLICK TRACKING (placeholder for analytics)
  // =========================================================================

  document.querySelectorAll('[href="#download"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      // Analytics.trackDownload would go here
      console.log('Download initiated');
    });
  });

  // =========================================================================
  // INIT
  // =========================================================================

  window.addEventListener('scroll', onScroll, { passive: true });

  // Initial checks
  updateNavbar();
  updateHeroScroll();

  // Expose for debugging
  window.FlowPaneLanding = {
    openMenu,
    closeMenu,
    revealObserver
  };
})();