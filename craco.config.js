import path from 'path';

export default {
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    extensions: ['.js', '.jsx', '.json'], // Add other extensions as needed
  },
  // Other Webpack configurations can go here
};