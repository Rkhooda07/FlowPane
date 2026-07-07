# FlowPane Onboarding Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-run onboarding guided tour to the FlowPane app without modifying any existing functionality, layouts, styling, or behaviors, using only index.html, main.js, and styles.css.

**Architecture:** A fixed full-screen overlay layer sits visually on top of the app. It uses `pointer-events: none` on the root, backdrop, and spotlight elements to allow interactions to pass through, and `pointer-events: auto` on interactive cards and tooltips. A highlight box with a massive `box-shadow` dims the rest of the screen while leaving a clear cutout centered over active elements. Layout positioning math dynamically moves and aligns the tooltips.

**Tech Stack:** Vanilla JS/HTML/CSS, Tauri Store API.

## Global Constraints
- Do not modify, rename, move, or restructure any existing HTML element, CSS class, or JS function.
- Do not add any new external dependencies, libraries, fonts, or CDN imports.
- Make the onboarding guide dismissible instantly, and persist the completion flag using tauri-plugin-store.
- Maintain title bar drag behavior (data-tauri-drag-region) during onboarding.

---

### Task 1: HTML Integration

**Files:**
- Modify: `src/index.html` (lines 334-340 and 514-515)

- [ ] **Step 1: Add the Replay Guide option to the Context Menu**
  Add the new menu item `<button class="context-item" id="menu-replay-guide">Replay Guide</button>` inside the context menu container.
  
  *Target Content in index.html:*
  ```html
      <!-- Context Menu -->
      <div id="context-menu" class="context-menu hidden" aria-hidden="true">
        <button class="context-item" id="menu-about">About FlowPane</button>
        <button class="context-item" id="menu-privacy">Privacy Policy</button>
        <div class="context-divider"></div>
        <button class="context-item quit" id="menu-quit">Quit</button>
      </div>
  ```
  
  *Replacement Content:*
  ```html
      <!-- Context Menu -->
      <div id="context-menu" class="context-menu hidden" aria-hidden="true">
        <button class="context-item" id="menu-about">About FlowPane</button>
        <button class="context-item" id="menu-privacy">Privacy Policy</button>
        <button class="context-item" id="menu-replay-guide">Replay Guide</button>
        <div class="context-divider"></div>
        <button class="context-item quit" id="menu-quit">Quit</button>
      </div>
  ```

- [ ] **Step 2: Add Onboarding Overlay Elements**
  Add the onboarding overlay markup at the bottom of the `#app` div, just before the closing tag.
  
  *Target Content in index.html:*
  ```html
      <div class="resize-handle sw"></div>
      <div class="resize-handle se"></div>
    </div>
  
    <script type="module" src="/main.js"></script>
  ```
  
  *Replacement Content:*
  ```html
      <div class="resize-handle sw"></div>
      <div class="resize-handle se"></div>
  
      <!-- Onboarding Overlay -->
      <div id="onboarding-overlay" class="onboarding-overlay hidden" aria-hidden="true">
        <div class="onboarding-backdrop" id="onboarding-backdrop"></div>
        
        <!-- Highlight box for active element spotlight -->
        <div class="onboarding-highlight-box" id="onboarding-highlight-box"></div>
        
        <!-- Welcome Card -->
        <div class="onboarding-welcome-card" id="onboarding-welcome-card">
          <div class="onboarding-welcome-icon">✨</div>
          <h3>Welcome to FlowPane</h3>
          <p>Your translucent, always-on-top workspace helper designed to keep you in your flow state. Let's take a quick 1-minute tour of how it works!</p>
          <div class="onboarding-welcome-actions">
            <button id="onboarding-start-btn" class="onboarding-next-btn">Get Started</button>
            <button id="onboarding-welcome-skip-btn" class="onboarding-skip-btn">Skip</button>
          </div>
        </div>
        
        <!-- Tooltip container -->
        <div class="onboarding-tooltip" id="onboarding-tooltip">
          <div class="onboarding-tooltip-body">
            <p id="onboarding-tooltip-text">Tooltip text goes here</p>
          </div>
          <div class="onboarding-tooltip-footer">
            <span id="onboarding-tooltip-progress" class="onboarding-progress">1 / 10</span>
            <div class="onboarding-tooltip-actions">
              <button id="onboarding-skip-link" class="onboarding-skip-btn">Skip Guide</button>
              <button id="onboarding-next-btn" class="onboarding-next-btn">Next</button>
            </div>
          </div>
          <div class="onboarding-arrow" id="onboarding-arrow"></div>
        </div>
      </div>
    </div>
  
    <script type="module" src="/main.js"></script>
  ```

- [ ] **Step 3: Verify HTML layout by running a check**
  Verify that the HTML compiles and there are no syntax errors or unclosed tags.

---

### Task 2: CSS Integration

**Files:**
- Modify: `src/styles.css` (Append to the end of the file)

- [ ] **Step 1: Append Onboarding Styles**
  Append the onboarding specific styling rules to the end of `src/styles.css`.
  
  *Code block to append:*
  ```css
  /* === ONBOARDING === */
  .onboarding-overlay {
    position: fixed;
    inset: 0;
    z-index: 10005; /* Must sit above everything else */
    pointer-events: none; /* Allow background dragging and clicking by default */
    opacity: 1;
    visibility: visible;
    transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.3s;
  }
  
  .onboarding-overlay.hidden {
    opacity: 0;
    visibility: hidden;
    pointer-events: none !important;
  }
  
  /* Semi-transparent dark overlay starting below title bar for welcome screen */
  .onboarding-backdrop {
    position: absolute;
    top: var(--navbar-height);
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 10006;
    opacity: 1;
    pointer-events: none; /* Let drag pass through to navbar, card will override this */
    transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }
  
  .onboarding-backdrop.hidden {
    opacity: 0;
    pointer-events: none !important;
  }
  
  /* Welcome Card style */
  .onboarding-welcome-card {
    position: absolute;
    top: 52%;
    left: 50%;
    transform: translate(-50%, -50%) scale(1);
    width: 82%;
    max-width: 280px;
    background: rgba(30, 30, 45, 0.96);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 18px;
    padding: 18px;
    text-align: center;
    box-shadow: 0 15px 35px rgba(0, 0, 0, 0.5);
    z-index: 10007;
    pointer-events: auto; /* Active clicking */
    transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    font-family: var(--font-family);
    color: var(--text-color);
  }
  
  .onboarding-welcome-card.hidden {
    opacity: 0;
    transform: translate(-50%, -46%) scale(0.95);
    pointer-events: none !important;
    display: none !important;
  }
  
  .onboarding-welcome-icon {
    font-size: 32px;
    margin-bottom: 8px;
  }
  
  .onboarding-welcome-card h3 {
    margin: 0 0 8px 0;
    font-size: 16px;
    font-weight: 600;
    color: #fff;
    letter-spacing: 0.2px;
  }
  
  .onboarding-welcome-card p {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.5;
    margin-bottom: 16px;
  }
  
  .onboarding-welcome-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
  }
  
  .onboarding-welcome-actions button {
    width: 100%;
  }
  
  /* Spotlight Highlight Box */
  .onboarding-highlight-box {
    position: absolute;
    pointer-events: none; /* Passive overlay, let clicks pass through to target */
    z-index: 10005;
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.4), 0 0 0 2px var(--accent-color), 0 0 15px rgba(0, 122, 255, 0.5);
    border-radius: 8px;
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    opacity: 1;
  }
  
  .onboarding-highlight-box.hidden {
    opacity: 0;
    box-shadow: none;
  }
  
  /* Tooltip container style */
  .onboarding-tooltip {
    position: absolute;
    z-index: 10008;
    width: 250px;
    background: rgba(25, 25, 35, 0.98);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    padding: 10px 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    pointer-events: auto; /* Active clicking */
    transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    font-family: var(--font-family);
    color: var(--text-color);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  
  .onboarding-tooltip.hidden {
    opacity: 0;
    pointer-events: none !important;
    display: none !important;
  }
  
  .onboarding-tooltip-body p {
    font-size: 11.5px;
    line-height: 1.45;
    color: rgba(255, 255, 255, 0.9);
    margin: 0;
  }
  
  .onboarding-tooltip-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    padding-top: 6px;
    margin-top: 2px;
  }
  
  .onboarding-progress {
    font-size: 10px;
    color: var(--text-secondary);
    font-weight: 500;
  }
  
  .onboarding-tooltip-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  /* Reuse primary/secondary button themes */
  .onboarding-next-btn {
    border: none;
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    background: var(--accent-color);
    color: #fff;
    transition: all 0.2s ease;
    pointer-events: auto;
  }
  
  .onboarding-next-btn:hover {
    transform: translateY(-1px);
    filter: brightness(1.1);
  }
  
  .onboarding-next-btn:active {
    transform: scale(0.98);
  }
  
  .onboarding-skip-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: 10px;
    cursor: pointer;
    padding: 4px;
    text-decoration: underline;
    transition: color 0.2s ease;
    pointer-events: auto;
  }
  
  .onboarding-skip-btn:hover {
    color: #fff;
  }
  
  .onboarding-welcome-card .onboarding-next-btn {
    padding: 8px 16px;
    font-size: 13px;
    border-radius: 8px;
  }
  
  .onboarding-welcome-card .onboarding-skip-btn {
    font-size: 11px;
    margin-top: 4px;
  }
  
  /* Caret/Arrow styles */
  .onboarding-arrow {
    position: absolute;
    width: 0;
    height: 0;
    border-style: solid;
    pointer-events: none;
    z-index: 10009;
  }
  
  /* Directions of arrow */
  .onboarding-arrow.arrow-top {
    border-width: 0 6px 6px 6px;
    border-color: transparent transparent rgba(25, 25, 35, 0.98) transparent;
    top: -6px;
  }
  
  .onboarding-arrow.arrow-bottom {
    border-width: 6px 6px 0 6px;
    border-color: rgba(25, 25, 35, 0.98) transparent transparent transparent;
    bottom: -6px;
  }
  
  /* Glow highlight border animation */
  @keyframes highlight-glow {
    0% { box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.4), 0 0 0 2px var(--accent-color), 0 0 10px rgba(0, 122, 255, 0.4); }
    50% { box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.4), 0 0 0 2px var(--accent-color), 0 0 18px rgba(0, 122, 255, 0.7); }
    100% { box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.4), 0 0 0 2px var(--accent-color), 0 0 10px rgba(0, 122, 255, 0.4); }
  }
  
  .onboarding-highlight-box:not(.hidden) {
    animation: highlight-glow 2s infinite ease-in-out;
  }
  ```

- [ ] **Step 2: Save the file and verify CSS syntax**

---

### Task 3: JavaScript Implementation

**Files:**
- Modify: `src/main.js` (lines 3905-3912, 3970-3990)

- [ ] **Step 1: Retrieve context menu elements and wire up Replay Guide listener**
  Add Replay Guide item selector and wire its click listener inside the production release context menu IIFE.
  
  *Target Content in main.js (around line 3905):*
  ```javascript
    const contextMenu = document.getElementById('context-menu');
    const aboutModal = document.getElementById('about-modal');
    const aboutVersion = document.getElementById('about-version');
    const aboutCloseBtn = document.getElementById('about-close-btn');
    const menuAbout = document.getElementById('menu-about');
    const menuPrivacy = document.getElementById('menu-privacy');
    const menuQuit = document.getElementById('menu-quit');
  ```
  
  *Replacement Content:*
  ```javascript
    const contextMenu = document.getElementById('context-menu');
    const aboutModal = document.getElementById('about-modal');
    const aboutVersion = document.getElementById('about-version');
    const aboutCloseBtn = document.getElementById('about-close-btn');
    const menuAbout = document.getElementById('menu-about');
    const menuPrivacy = document.getElementById('menu-privacy');
    const menuQuit = document.getElementById('menu-quit');
    const menuReplayGuide = document.getElementById('menu-replay-guide');
  ```
  
  *Also add listener before the end of the block (around line 3968):*
  
  *Target Content:*
  ```javascript
      aboutCloseBtn.addEventListener('click', () => {
        if (aboutModal) aboutModal.classList.add('hidden');
      });
    }
  ```
  
  *Replacement Content:*
  ```javascript
      aboutCloseBtn.addEventListener('click', () => {
        if (aboutModal) aboutModal.classList.add('hidden');
      });
    }
  
    if (menuReplayGuide) {
      menuReplayGuide.addEventListener('click', () => {
        startOnboardingTour();
      });
    }
  ```

- [ ] **Step 2: Implement Onboarding Tour Logic**
  Replace the skeleton `initOnboarding()` function with the complete onboarding engine including steps, flags, positioning, cleanups on Next/Skip, and Store saving.
  
  *Target Content in main.js:*
  ```javascript
    // Onboarding Logic
    async function initOnboarding() {
      // Wait for store to be ready
      const checkStore = setInterval(async () => {
        if (typeof store !== 'undefined' && store !== null) {
          clearInterval(checkStore);
          try {
            const hasSeen = await store.get('hasSeenOnboarding');
            if (!hasSeen) {
              console.log('First launch detected. Showing onboarding...');
              // In a real app, we would show a nice overlay here.
              // For now, we'll just set the flag.
              await store.set('hasSeenOnboarding', true);
              await store.save();
            }
          } catch (e) {
            console.error('Onboarding check failed:', e);
          }
        }
      }, 500);
    }
  ```
  
  *Replacement Content:*
  ```javascript
    // Onboarding Logic
    let currentOnboardingStep = 0;
    let onboardingExpandedInput = false;
    let onboardingExpandedFilter = false;
  
    const onboardingSteps = [
      {
        selector: null,
        copy: "Welcome to FlowPane! Your translucent, always-on-top companion designed to keep you in your flow state. Let's take a quick 1-minute tour."
      },
      {
        selector: ".window-controls",
        copy: "FlowPane floats above your other windows. These eyes track your cursor to keep your focus centered!"
      },
      {
        selector: ".fold-guide",
        copy: "Drag the pane to screen edges to snap and collapse it into a minimal floating indicator."
      },
      {
        selector: "#task-input",
        copy: "Type a task description or note title here, then press Enter to quickly add it."
      },
      {
        selector: "#task-due-date-btn",
        copy: "Click the calendar to set a deadline or due date for the task you are adding."
      },
      {
        selector: "#task-reminder-btn",
        copy: "Schedule a reminder notification to alert you before your task deadline."
      },
      {
        selector: "#task-timer-btn",
        copy: "Set a focus duration to launch a Pomodoro-style timer in Focus Mode."
      },
      {
        selector: ".task-notes-icons",
        copy: "Select a color tab to create separate, color-coded workspaces for notes."
      },
      {
        selector: ".filter-icon",
        copy: "Click this funnel to toggle the visibility of the filter controls."
      },
      {
        selector: ".filter-options",
        copy: "Switch between viewing everything, just active tasks, or note pages."
      },
      {
        selector: "#history-btn",
        copy: "Open the completed tasks history to review your finished items or restore them."
      },
      {
        selector: "#task-input",
        copy: "You're all set! Start typing your first task above to begin."
      }
    ];
  
    function cleanupStep(stepIndex) {
      // Step 5 (Bell Icon) Cleanup
      if (stepIndex === 5 && onboardingExpandedInput) {
        const inputArea = document.querySelector('.input-area');
        if (inputArea) {
          inputArea.classList.remove('expanded');
        }
        onboardingExpandedInput = false;
      }
      // Step 9 (Filter Options) Cleanup
      if (stepIndex === 9 && onboardingExpandedFilter) {
        const filterOptions = document.querySelector('.filter-options');
        if (filterOptions) {
          filterOptions.classList.add('hidden');
          filterOptions.style.display = '';
        }
        onboardingExpandedFilter = false;
      }
    }
  
    function endOnboarding() {
      // Clean up both states to be safe
      cleanupStep(5);
      cleanupStep(9);
      
      const overlay = document.getElementById('onboarding-overlay');
      if (overlay) {
        overlay.classList.add('hidden');
        overlay.setAttribute('aria-hidden', 'true');
      }
      
      // Save seen status
      void saveOnboardingSeen();
    }
  
    async function saveOnboardingSeen() {
      try {
        if (store) {
          await store.set('hasSeenOnboarding', true);
          await store.save();
        } else {
          localStorage.setItem('hasSeenOnboarding', 'true');
        }
      } catch (e) {
        console.error('Failed to save onboarding preference:', e);
        localStorage.setItem('hasSeenOnboarding', 'true');
      }
    }
  
    function startOnboardingTour() {
      currentOnboardingStep = 0;
      
      const overlay = document.getElementById('onboarding-overlay');
      const backdrop = document.getElementById('onboarding-backdrop');
      const welcomeCard = document.getElementById('onboarding-welcome-card');
      const tooltip = document.getElementById('onboarding-tooltip');
      const highlight = document.getElementById('onboarding-highlight-box');
      
      if (!overlay) return;
      
      // Reset layout states
      cleanupStep(5);
      cleanupStep(9);
      
      overlay.classList.remove('hidden');
      overlay.setAttribute('aria-hidden', 'false');
      backdrop.classList.remove('hidden');
      welcomeCard.classList.remove('hidden');
      tooltip.classList.add('hidden');
      highlight.classList.add('hidden');
    }
  
    function positionOnboardingTooltip(targetEl) {
      const tooltip = document.getElementById('onboarding-tooltip');
      const arrow = document.getElementById('onboarding-arrow');
      const highlight = document.getElementById('onboarding-highlight-box');
      
      if (!tooltip || !arrow || !highlight || !targetEl) return;
      
      const rect = targetEl.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      // 1. Position highlight box
      if (rect.width === 0 || rect.height === 0) {
        // Fallback: If target is hidden, center the tooltip without arrow or highlight
        highlight.classList.add('hidden');
        arrow.style.display = 'none';
        
        tooltip.style.display = 'flex';
        tooltip.classList.remove('hidden');
        
        const tooltipWidth = tooltip.offsetWidth || 250;
        const tooltipHeight = tooltip.offsetHeight || 80;
        
        tooltip.style.left = `${(viewportWidth - tooltipWidth) / 2}px`;
        tooltip.style.top = `${(viewportHeight - tooltipHeight) / 2}px`;
        return;
      }
      
      arrow.style.display = 'block';
      highlight.style.top = `${rect.top}px`;
      highlight.style.left = `${rect.left}px`;
      highlight.style.width = `${rect.width}px`;
      highlight.style.height = `${rect.height}px`;
      
      const targetRadius = window.getComputedStyle(targetEl).borderRadius;
      highlight.style.borderRadius = targetRadius || '8px';
      highlight.classList.remove('hidden');
      
      // 2. Decide placement: above or below
      const targetCenterY = rect.top + rect.height / 2;
      const placeBelow = targetCenterY < 185;
      
      tooltip.style.display = 'flex';
      tooltip.classList.remove('hidden');
      
      const tooltipWidth = tooltip.offsetWidth || 250;
      const tooltipHeight = tooltip.offsetHeight || 80;
      
      let tooltipLeft = rect.left + rect.width / 2 - tooltipWidth / 2;
      const minMargin = 12;
      tooltipLeft = Math.max(minMargin, Math.min(viewportWidth - tooltipWidth - minMargin, tooltipLeft));
      
      let tooltipTop = 0;
      
      if (placeBelow) {
        tooltipTop = rect.bottom + 10;
        arrow.className = 'onboarding-arrow arrow-top';
        arrow.style.bottom = '';
        arrow.style.top = '-6px';
      } else {
        tooltipTop = rect.top - tooltipHeight - 10;
        arrow.className = 'onboarding-arrow arrow-bottom';
        arrow.style.top = '';
        arrow.style.bottom = '-6px';
      }
      
      let arrowLeft = rect.left + rect.width / 2 - tooltipLeft - 6;
      const arrowPadding = 12;
      arrowLeft = Math.max(arrowPadding, Math.min(tooltipWidth - arrowPadding - 12, arrowLeft));
      
      tooltip.style.left = `${tooltipLeft}px`;
      tooltip.style.top = `${tooltipTop}px`;
      arrow.style.left = `${arrowLeft}px`;
    }
  
    function updateCurrentTooltipPosition() {
      const overlay = document.getElementById('onboarding-overlay');
      if (!overlay || overlay.classList.contains('hidden')) return;
      
      if (currentOnboardingStep === 0) return;
      
      const step = onboardingSteps[currentOnboardingStep];
      if (!step || !step.selector) return;
      
      const targetEl = document.querySelector(step.selector);
      if (targetEl) {
        positionOnboardingTooltip(targetEl);
      }
    }
  
    function showOnboardingStep(stepIndex) {
      cleanupStep(currentOnboardingStep);
      currentOnboardingStep = stepIndex;
      
      const welcomeCard = document.getElementById('onboarding-welcome-card');
      const backdrop = document.getElementById('onboarding-backdrop');
      const tooltip = document.getElementById('onboarding-tooltip');
      const textEl = document.getElementById('onboarding-tooltip-text');
      const progressEl = document.getElementById('onboarding-tooltip-progress');
      const nextBtn = document.getElementById('onboarding-next-btn');
      
      if (stepIndex === 0) {
        startOnboardingTour();
        return;
      }
      
      welcomeCard.classList.add('hidden');
      backdrop.classList.add('hidden');
      
      const step = onboardingSteps[stepIndex];
      if (!step) return;
      
      // Setup dynamic workspace expansions
      if (stepIndex === 5) {
        const inputArea = document.querySelector('.input-area');
        if (inputArea) {
          const isExpanded = inputArea.classList.contains('expanded');
          if (!isExpanded) {
            inputArea.classList.add('expanded');
            onboardingExpandedInput = true;
          }
        }
      }
      
      if (stepIndex === 9) {
        const filterOptions = document.querySelector('.filter-options');
        if (filterOptions) {
          const isVisible = getComputedStyle(filterOptions).display !== 'none' && !filterOptions.classList.contains('hidden');
          if (!isVisible) {
            filterOptions.classList.remove('hidden');
            filterOptions.style.display = 'flex';
            onboardingExpandedFilter = true;
          }
        }
      }
      
      textEl.textContent = step.copy;
      progressEl.textContent = `${stepIndex} / ${onboardingSteps.length - 1}`;
      
      if (stepIndex === onboardingSteps.length - 1) {
        nextBtn.textContent = 'Finish';
      } else {
        nextBtn.textContent = 'Next';
      }
      
      // Position the elements dynamically
      setTimeout(() => {
        const targetEl = document.querySelector(step.selector);
        if (targetEl) {
          positionOnboardingTooltip(targetEl);
        }
      }, 50); // slight delay to allow layout transitions
    }
  
    async function initOnboarding() {
      // Bind Onboarding UI events
      const startBtn = document.getElementById('onboarding-start-btn');
      const welcomeSkipBtn = document.getElementById('onboarding-welcome-skip-btn');
      const skipLink = document.getElementById('onboarding-skip-link');
      const nextBtn = document.getElementById('onboarding-next-btn');
      
      if (startBtn) {
        startBtn.addEventListener('click', () => {
          showOnboardingStep(1);
        });
      }
      
      if (welcomeSkipBtn) {
        welcomeSkipBtn.addEventListener('click', () => {
          endOnboarding();
        });
      }
      
      if (skipLink) {
        skipLink.addEventListener('click', () => {
          endOnboarding();
        });
      }
      
      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          if (currentOnboardingStep >= onboardingSteps.length - 1) {
            endOnboarding();
          } else {
            showOnboardingStep(currentOnboardingStep + 1);
          }
        });
      }
      
      window.addEventListener('resize', updateCurrentTooltipPosition);
  
      // Wait for store to be ready
      const checkStore = setInterval(async () => {
        if (typeof store !== 'undefined' && store !== null) {
          clearInterval(checkStore);
          try {
            let hasSeen = await store.get('hasSeenOnboarding');
            if (hasSeen === null || hasSeen === undefined) {
              // Also check localStorage
              hasSeen = localStorage.getItem('hasSeenOnboarding') === 'true';
            }
            if (!hasSeen) {
              console.log('First launch detected. Showing onboarding...');
              startOnboardingTour();
            }
          } catch (e) {
            console.error('Onboarding check failed, checking localStorage:', e);
            const hasSeen = localStorage.getItem('hasSeenOnboarding') === 'true';
            if (!hasSeen) {
              startOnboardingTour();
            }
          }
        }
      }, 250);
    }
  ```

---

### Task 4: Verification & Checking

- [ ] **Step 1: Test welcome screen render**
  Clear the `hasSeenOnboarding` store state and reload, and confirm the welcome screen displays with correct alignment.
- [ ] **Step 2: Test guided tour navigation**
  Click "Get Started" and navigate through all 10 tooltip locations. Confirm alignment, arrow position, and spotlight boxes match the boundaries.
- [ ] **Step 3: Test cleanup transitions**
  Confirm the input area collapses when navigating past Step 5, and the filter options collapse when navigating past Step 9.
- [ ] **Step 4: Test exit behavior**
  Verify clicking "Skip Guide" on Step 5 and Step 9 resets the input area and filter options back to their original states.
- [ ] **Step 5: Verify Replay Guide**
  Right-click anywhere to trigger the context menu, select "Replay Guide", and confirm the tour starts from Step 0.
