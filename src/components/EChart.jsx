import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

export default function EChart({ option, height = 300, className = '', style = {}, onInit }) {
  const containerRef = useRef(null);
  const chartInstanceRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(containerRef.current, null, {
        renderer: 'canvas',
      });
      if (typeof onInit === 'function') {
        onInit(chartInstanceRef.current);
      }
    }

    if (option) {
      chartInstanceRef.current.setOption(option, true);
    }
  }, [option, onInit]);

  useEffect(() => {
    const handleResize = () => {
      chartInstanceRef.current?.resize();
    };

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(containerRef.current);
    }

    window.addEventListener('resize', handleResize);

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', handleResize);
      if (chartInstanceRef.current) {
        chartInstanceRef.current.dispose();
        chartInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width: '100%',
        height: `${height}px`,
        minHeight: `${height}px`,
        ...style,
      }}
    />
  );
}
