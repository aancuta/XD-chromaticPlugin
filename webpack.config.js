var path = require('path');

module.exports = {
  optimization: {
    minimize: false
  },
  entry: './gradient.js',
  output: {
    filename: 'main.js',
    path: path.resolve(__dirname, 'Chromatic Gradients'),
  },
  target: 'node',
  externals: {
	'scenegraph': 'commonjs scenegraph'
  },
};

