/* eslint no-param-reassign: [0], no-console: [0] */

import 'babel-regenerator-runtime';

import { template, map, flow, compact } from 'lodash/fp';
import React from 'react';
import { renderToString } from 'react-dom/server';
import Express from 'express';
import bodyParser from 'body-parser';
import { createStore, applyMiddleware } from 'redux';
import { Provider } from 'react-redux';
import thunk from 'redux-thunk';
import { RouterContext, match } from 'react-router';
import fetch from 'node-fetch';
import fetchMiddleware from '../src/middlewares/fetch';
import routes from '../src/routes';
import { reducers } from '../src/redux';
import formDispatcherBase from '../src/formDispatcherBase';

import { readFileSync } from 'fs';
import { join } from 'path';


const config = {
  clientEndpoint: 'http://localhost:8081',
  serverEndpoint: 'http://localhost:8081',
  port: 8080,
};


const index = readFileSync(join(__dirname, './index.html'));
const renderTemplate = template(index);

const server = new Express();
server.use(bodyParser.urlencoded({ extended: true }));


// STATIC FILES
server.use('/dist', Express.static(join(__dirname, '../dist')));


// SETUP STORE
server.all('*', (req, res, next) => {
  const middlewares = applyMiddleware(
    thunk,
    fetchMiddleware(config.serverEndpoint, fetch)
  );
  req.store = createStore(reducers, middlewares);

  next();
});


// FORM HANDLERS
server.post('*', async (req, res, next) => {
  try {
    const inputParams = req.body;
    const { redirect } = await req.store.dispatch(formDispatcherBase(inputParams));

    if (redirect) {
      res.redirect(redirect);
    } else {
      next();
    }
  } catch (e) {
    console.log(e);
    next();
  }
});


// RENDER PAGE
server.all('*', (req, res) => {
  const { store } = req;

  match({ routes, location: req.url }, (error, redirectLocation, renderProps) => {
    if (redirectLocation) {
      res.redirect(301, redirectLocation.pathname + redirectLocation.search);
    } else if (error) {
      res.status(500).send(error.message);
    } else if (!renderProps) {
      res.status(404).send('Not found');
    } else {
      const { location, params } = renderProps;
      const { dispatch, getState } = store;

      const dataFetchingRequirements = flow(
        map('WrappedComponent.fetchData'),
        compact,
        map(fetchData => fetchData({ location, params, dispatch }))
      )(renderProps.components);

      Promise.all(dataFetchingRequirements)
        .catch(() => {}) // Ignore errors from data fetching
        .then(() => {
          const reduxState = getState();
          const markup = renderToString(
            <Provider store={store}>
              <RouterContext {...renderProps} />
            </Provider>
          );

          return { markup, reduxState };
        })
        .catch(e => { // But not errors from rendering to a string
          console.error(`Failed to serve ${req.url}`);
          console.error(e);

          const markup = renderToString(<RouterContext {...renderProps} />);
          return { markup, reduxState: null };
        })
        .then(({ markup, reduxState }) => {
          res.send(renderTemplate({
            apiEndpoint: config.clientEndpoint,
            markup,
            reduxState,
          }));
        }, () => {
          res.status(500).send('Failed to load page');
        });
    }
  });
});

server.listen(config.port, err => {
  if (err) {
    console.error(err);
  } else {
    console.log('Server started');
  }
});
