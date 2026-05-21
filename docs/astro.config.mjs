// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { visit } from 'unist-util-visit';

/**
 * Convert ```mermaid fenced code blocks into raw <div class="mermaid"> HTML
 * BEFORE expressive-code/syntax-highlighting touches them, so Mermaid's
 * client-side runtime sees the original source instead of highlighted spans.
 */
function remarkMermaid() {
  return (tree) => {
    visit(tree, 'code', (node, index, parent) => {
      if (node.lang !== 'mermaid' || !parent || typeof index !== 'number') return;
      const src = node.value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      parent.children[index] = {
        type: 'html',
        value: `<div class="mermaid not-content">${src}</div>`,
      };
    });
  };
}

// https://astro.build/config
export default defineConfig({
  site: 'https://mtbui2010.github.io',
  base: '/robotapp',
  trailingSlash: 'ignore',
  markdown: {
    remarkPlugins: [remarkMermaid],
  },
  integrations: [
    starlight({
      title: 'RobotApp',
      description:
        'A real-time ops console + FastAPI runtime for ROS2 mobile manipulators.',
      logo: {
        src: './src/assets/logo.svg',
        replacesTitle: false,
      },
      social: {
        github: 'https://github.com/mtbui2010/robotapp',
      },
      customCss: ['./src/styles/custom.css'],
      components: {
        // We use the default components — light theme is forced via CSS.
      },
      sidebar: [
        { label: 'Overview', link: '/' },
        {
          label: 'The Stack',
          items: [
            { label: 'robotapp · UI', link: '/stack/robotapp/' },
            { label: 'robot_agent · Runtime', link: '/stack/robot-agent/' },
            { label: 'kcare_robot · Reference', link: '/stack/kcare-robot/' },
            { label: 'robot_template · Scaffold', link: '/stack/robot-template/' },
          ],
        },
        {
          label: 'Deep Dive',
          items: [
            { label: 'Architecture', link: '/deep-dive/architecture/' },
            { label: 'Streaming protocol', link: '/deep-dive/streaming/' },
            { label: 'Perception pipeline', link: '/deep-dive/perception/' },
          ],
        },
        { label: 'About / Contact', link: '/about/' },
      ],
      head: [
        {
          tag: 'meta',
          attrs: {
            property: 'og:image',
            content:
              'https://mtbui2010.github.io/robotapp/og-image.png',
          },
        },
        {
          tag: 'script',
          attrs: { type: 'module' },
          content: `
            import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

            const render = () => {
              // Cache original source on first render so theme switches can re-render.
              document.querySelectorAll('.mermaid').forEach((n) => {
                if (!n.dataset.source) n.dataset.source = n.textContent || '';
              });
              const isDark = document.documentElement.dataset.theme === 'dark';
              mermaid.initialize({
                startOnLoad: false,
                theme: isDark ? 'dark' : 'default',
                themeVariables: {
                  primaryColor: isDark ? '#1e3a8a' : '#dbeafe',
                  primaryTextColor: isDark ? '#e2e8f0' : '#0f172a',
                  primaryBorderColor: '#2563eb',
                  lineColor: isDark ? '#64748b' : '#94a3b8',
                  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
                  fontSize: '14px',
                },
                securityLevel: 'loose',
              });
              const nodes = document.querySelectorAll('.mermaid:not([data-processed])');
              if (nodes.length) mermaid.run({ nodes });
            };
            render();

            new MutationObserver((muts) => {
              for (const m of muts) {
                if (m.type === 'attributes' && m.attributeName === 'data-theme') {
                  document.querySelectorAll('.mermaid').forEach((n) => {
                    n.removeAttribute('data-processed');
                    if (n.dataset.source) n.innerHTML = n.dataset.source;
                  });
                  render();
                }
              }
            }).observe(document.documentElement, { attributes: true });
          `,
        },
      ],
      lastUpdated: true,
      pagination: true,
    }),
  ],
});
