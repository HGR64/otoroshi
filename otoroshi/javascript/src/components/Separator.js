import React, { Component } from 'react';

export class Separator extends Component {
  render() {
    return (
      <div className="form__group mb-20 grid-template-xs--fifth">
        <label />
        <div style={{ borderBottom: '1px solid #666', paddingBottom: 5 }}>
          {this.props.title}
        </div>
      </div>
    );
  }
}
