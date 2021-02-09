import React, { Component } from 'react';
import * as BackOfficeServices from '../services/BackOfficeServices';
import {
  Table,
  TextInput,
  TextareaInput,
  LabelInput,
  BooleanInput,
  ArrayInput,
  SelectInput,
  NumberInput,
  BiColumnBooleanInput,
} from '../components/inputs';
import moment from 'moment';
import faker from 'faker';

class CertificateInfos extends Component {
  state = {
    cert: null,
    error: null,
  };

  update = (chain) => {
    BackOfficeServices.certData(chain)
      .then((cert) => {
        if (cert.error) {
          this.setState({ cert: null, error: cert.error });
        } else {
          this.setState({ cert, error: null });
          const domain = this.props.rawValue.domain;
          const rawCopy = { ...this.props.rawValue };
          if (!domain) {
            rawCopy.domain = cert.domain;
            this.props.rawOnChange(rawCopy);
          }
          if (domain && domain !== cert.domain) {
            rawCopy.domain = cert.domain;
            this.props.rawOnChange(rawCopy);
          }
        }
      })
      .catch((e) => {
        this.setState({ cert: null, error: e });
      });
  };

  componentDidMount() {
    this.update(this.props.rawValue.chain);
  }

  componentWillReceiveProps(next) {
    if (next.rawValue && next.rawValue !== this.props.rawValue) {
      this.update(next.rawValue.chain);
    }
  }

  render() {
    if (!this.state.cert) return null;
    if (!!this.state.error)
      return (
        <div>
          <LabelInput label="Infos" value={this.state.error} />
        </div>
      );
    return (
      <div>
        <TextInput label="Subject" disabled={true} value={this.state.cert.subjectDN} />
        <TextInput label="Issuer" disabled={true} value={this.state.cert.issuerDN} />
        <TextInput label="Domain" disabled={true} value={this.state.cert.domain} />
        {(this.state.cert.subAltNames || []).map((name, idx) => (
          <TextInput
            label={idx === 0 ? 'SANs' : ''}
            help={idx === 0 ? 'Certificate Subject Alternate Names' : null}
            disabled={true}
            value={name}
          />
        ))}
        {/*<ArrayInput label="Subject Alternate Names" disabled={true} value={this.state.cert.subAltNames || []} />*/}
        <BooleanInput
          label="Let's Encrypt"
          disabled={true}
          value={this.props.rawValue.letsEncrypt}
        />
        <BooleanInput label="Self signed" disabled={true} value={this.state.cert.selfSigned} />
        <BooleanInput label="CA" disabled={true} value={this.state.cert.ca} />
        <TextInput
          label="Serial number"
          disabled={true}
          value={'Ox' + this.state.cert.serialNumber.toUpperCase()}
        />
        <TextInput
          label="Valid from"
          disabled={true}
          value={moment(this.state.cert.notBefore).format('DD/MM/YYYY HH:mm:ss')}
        />
        <TextInput
          label="Valid until"
          disabled={true}
          value={moment(this.state.cert.notAfter).format('DD/MM/YYYY HH:mm:ss')}
        />
        <TextInput label="Signature" disabled={true} value={this.state.cert.signature} />
        <TextareaInput
          label="Public key"
          disabled={true}
          rows={6}
          style={{ fontFamily: 'monospace',width:'100%' }}
          value={this.state.cert.publicKey}
        />
      </div>
    );
  }
}

class Commands extends Component {
  state = {};

  createCASigned = (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    window
      .popup(
        'New Certificate',
        (ok, cancel) => <NewCertificateForm ok={ok} cancel={cancel} caRef={id} />,
        { style: { width: '100%' } }
      )
      .then((form) => {
        if (form) {
          BackOfficeServices.createCertificateFromForm(form).then((cert) => {
            this.props.setTitle(`Create a new Certificate`);
            window.history.replaceState({}, '', `/bo/dashboard/certificates/add`);
            if (form.letsEncrypt) {
              this.table.setState({ currentItem: cert, showEditForm: true });
            } else {
              this.table.setState({ currentItem: cert, showAddForm: true });
            }
          });
        }
      });
    // window.newPrompt('Certificate hostname').then(value => {
    //   if (value && value.trim() !== '') {
    //     BackOfficeServices.caSignedCert(id, value).then(cert => {
    //       this.props.setTitle(`Create a new certificate`);
    //       window.history.replaceState({}, '', `/bo/dashboard/certificates/add`);
    //       this.props.table().setState({ currentItem: cert, showAddForm: true });
    //     });
    //   }
    // });
  };

  componentDidMount() {
    const cert = this.props.rawValue.chain
      ? this.props.rawValue.chain.split('-----END CERTIFICATE-----')[0] +
        '-----END CERTIFICATE-----'
      : '';
    this.setState({
      fullChainUrl: URL.createObjectURL(
        new Blob([this.props.rawValue.chain], { type: 'text/plain' })
      ),
      privateKeyUrl: URL.createObjectURL(
        new Blob([this.props.rawValue.privateKey], { type: 'text/plain' })
      ),
      fullPkUrl: URL.createObjectURL(
        new Blob([this.props.rawValue.chain + '\n' + this.props.rawValue.privateKey], {
          type: 'text/plain',
        })
      ),
      certUrl: URL.createObjectURL(new Blob([cert], { type: 'text/plain' })),
    });
  }

  render() {
    const certIsEmpty = !(this.props.rawValue.chain && this.props.rawValue.privateKey);
    const canRenew =
      this.props.rawValue.letsEncrypt ||
      this.props.rawValue.ca ||
      this.props.rawValue.selfSigned ||
      !!this.props.rawValue.caRef;
    return (
      <div>
        <div className="btn__group--right">
          {this.props.rawValue.ca && (
            <button
              type="button"
              className="button btn-sm btn-success mr-5 mb-5"
              onClick={(e) => {
                this.createCASigned(e, this.props.rawValue.id);
              }}>
              <i className="fas fa-plus-circle" /> Create cert.
            </button>
          )}
          {canRenew && (
            <button
              type="button"
              className="button btn-sm btn-success mr-5 mb-5"
              onClick={(e) => {
                BackOfficeServices.renewCert(this.props.rawValue.id).then((cert) => {
                  this.props.rawOnChange(cert);
                });
              }}>
              <i className="fas fa-redo" /> Renew
            </button>
          )}
          {false && (
            <button
              type="button"
              className="button btn-sm btn-success mr-5 mb-5"
              onClick={(e) => {
                window.newPrompt('Certificate host ?').then((value) => {
                  if (value && value.trim() !== '') {
                    BackOfficeServices.selfSignedCert(value).then((cert) => {
                      this.props.rawOnChange(cert);
                    });
                  }
                });
              }}>
              <i className="fas fa-screwdriver" /> Generate self signed cert.
            </button>
          )}
          <a
            href={this.state.certUrl}
            download={`${this.props.rawValue.domain}.cer`}
            className="button btn-sm btn-success mr-5 mb-5">
            <i className="fas fa-download" /> Certificate Only
          </a>
          <a
            href={this.state.fullChainUrl}
            download={`${this.props.rawValue.domain}.fullchain.cer`}
            className="button btn-sm btn-success mr-5 mb-5">
            <i className="fas fa-download" /> Full Chain
          </a>
          <a
            href={this.state.privateKeyUrl}
            download={`${this.props.rawValue.domain}.key`}
            className="button btn-sm btn-success mr-5 mb-5">
            <i className="fas fa-download" /> Private Key
          </a>
          <a
            href={this.state.fullPkUrl}
            download={`${this.props.rawValue.domain}.pem`}
            className="button btn-sm btn-success mb-5">
            <i className="fas fa-download" /> Full Chain + Private Key
          </a>
        </div>
      </div>
    );
  }
}

class CertificateValid extends Component {
  state = {
    loading: false,
    valid: null,
    error: null,
  };

  update = (cert) => {
    if (!cert.privateKey || cert.privateKey.trim() === '') {
      return;
    }
    this.setState({ loading: true }, () => {
      BackOfficeServices.certValid(cert)
        .then((payload) => {
          if (payload.error) {
            this.setState({ loading: false, valid: false, error: payload.error });
          } else {
            this.setState({ valid: payload.valid, loading: false, error: null });
          }
        })
        .catch((e) => {
          this.setState({ loading: false, valid: false, error: e });
        });
    });
  };

  componentDidMount() {
    this.update(this.props.rawValue);
  }

  componentWillReceiveProps(next) {
    if (next.rawValue && next.rawValue !== this.props.rawValue) {
      this.update(next.rawValue);
    }
  }

  render() {
    if (this.state.loading)
      return (
        <div>
          <LabelInput label="Error" value="Loading ..." />
        </div>
      );
    if (!!this.state.error)
      return (
        <div>
          <LabelInput label="Error" value={this.state.error} />
        </div>
      );
    return (
      <div className="form__group mb-20 grid-template-col-xs-up__1fr-5fr">
        <label />
        <div>
          {this.state.valid === true && (
            <div className="alert alert-success" role="alert">
              Your certificate is valid
            </div>
          )}
          {this.state.valid === false && (
            <div className="alert alert-danger" role="alert">
              Your certificate is not valid
            </div>
          )}
        </div>
      </div>
    );
  }
}

export class CertificatesPage extends Component {
  formSchema = {
    id: { type: 'string', disabled: true, props: { label: 'Id', placeholder: '---' } },
    name: {
      type: 'string',
      props: { label: 'Name', placeholder: 'www.oto.tools' },
    },
    description: {
      type: 'string',
      props: { label: 'Description', placeholder: 'Certificate for www.oto.tools' },
    },
    domain: {
      type: 'string',
      disabled: true,
      props: { label: 'Certificate domain', placeholder: 'www.oto.tools' },
    },
    metadata: {
      type: 'object',
      props: { label: 'Certificate metadata' },
    },
    commands: {
      type: Commands,
      props: {
        setTitle: (t) => this.props.setTitle(t),
        table: () => this.table,
      },
    },
    infos: {
      type: CertificateInfos,
      props: {},
    },
    valid: {
      type: CertificateValid,
      props: {},
    },
    chain: {
      type: 'text',
      props: { label: 'Certificate full chain', rows: 6, style: { fontFamily: 'monospace',width:'100%' } },
    },
    privateKey: {
      type: 'text',
      props: { label: 'Certificate private key', rows: 6, style: { fontFamily: 'monospace',width:'100%' } },
    },
    autoRenew: {
      type: 'bool',
      props: { label: 'Auto renew cert.' },
    },
    client: {
      type: 'bool',
      props: { label: 'Client cert.' },
    },
    keypair: {
      type: 'bool',
      props: { label: 'Keypair' },
    },
    _loc: {
      type: 'location',
      props: {},
    },
  };

  columns = [
    { title: 'Name', content: (item) => item.name },
    { title: 'Description', content: (item) => item.description },
    // { title: 'Domain', content: item => (!item.ca ? item.domain : '') },
    { title: 'Subject', content: (item) => item.subject },
    // {
    //   title: 'Valid',
    //   content: item => {
    //     const now = Date.now();
    //     return item.valid && (now > item.from && now < item.to) ? 'yes' : 'no';
    //   },
    //   style: { textAlign: 'center', width: 70 },
    //   notFilterable: true,
    // },
    {
      title: ' ',
      content: (item) =>
        !item.ca ? null : (
          /*'yes'*/ <button
            type="button"
            className="btn-info btn-sm"
            onClick={(e) => this.createCASigned(e, item.id)}>
            <i className="fas fa-plus-circle" />
          </button>
        ),
      style: { textAlign: 'center', width: 70 },
      notFilterable: true,
    },
    {
      title: 'Type',
      cell: (v, item, table) =>
        item.client ? (
          <span className="label bg__primary">client</span>
        ) : item.ca ? (
          <span className="label bg__info">ca</span>
        ) : item.letsEncrypt ? (
          <span className="label bg__warning">let's encrypt</span>
        ) : item.keypair ? (
          <span className="label bg__dark">keypair</span>
        ) : item.selfSigned ? (
          <span className="label bg__alert">self signed</span>
        ) : (
          <span className="label bg__success">certificate</span>
        ),
      content: (item) =>
        item.client
          ? 'client'
          : item.ca
          ? 'ca'
          : item.letsEncrypt
          ? 'letsencrypt'
          : item.keypair
          ? 'keypair'
          : item.selfSigned
          ? 'selfsigned'
          : 'certificate',
      style: { textAlign: 'center', width: 100 },
      notFilterable: false,
    },
    // {
    //   title: 'Client',
    //   content: item => (!item.client ? 'no' : <span className="label bg__success">yes</span>),
    //   style: { textAlign: 'center', width: 70 },
    //   notFilterable: true,
    // },
    // {
    //   title: 'Self signed',
    //   content: item => (item.selfSigned ? <span className="label bg__alert">yes</span> : 'no'),
    //   style: { textAlign: 'center', width: 90 },
    //   notFilterable: true,
    // },
    // {
    //   title: 'Let\'s Encrypt',
    //   content: item => (!item.letsEncrypt ? 'no' : <span className="label bg__success">yes</span>),
    //   style: { textAlign: 'center', width: 90 },
    //   notFilterable: true,
    // },
    {
      title: 'From',
      content: (item) => moment(item.from).format('DD/MM/YYYY HH:mm:ss'),
      style: { textAlign: 'center', width: 150 },
    },
    {
      title: 'To',
      content: (item) => moment(item.to).format('DD/MM/YYYY HH:mm:ss'),
      style: { textAlign: 'center', width: 150 },
    },
  ];

  formFlow = [
    '_loc',
    'id',
    'name',
    'description',
    'autoRenew',
    'client',
    'keypair',
    'commands',
    'valid',
    'chain',
    'privateKey',
    'infos',
    'metadata',
  ];

  componentDidMount() {
    this.props.setTitle(`All certificates`);
    if (window.history.state && window.history.state.cert) {
      this.props.setTitle(`Create a new certificate`);
      this.table.setState({ currentItem: window.history.state.cert, showAddForm: true });
    }
  }

  createSelfSigned = () => {
    window.newPrompt('Certificate domain').then((value) => {
      if (value && value.trim() !== '') {
        BackOfficeServices.selfSignedCert(value).then((cert) => {
          this.props.setTitle(`Create a new certificate`);
          window.history.replaceState({}, '', `/bo/dashboard/certificates/add`);
          this.table.setState({ currentItem: cert, showAddForm: true });
        });
      }
    });
  };

  createSelfSignedClient = () => {
    window.newPrompt('Certificate DN').then((value) => {
      if (value && value.trim() !== '') {
        BackOfficeServices.selfSignedClientCert(value).then((cert) => {
          // console.log(cert);
          this.props.setTitle(`Create a new certificate`);
          window.history.replaceState({}, '', `/bo/dashboard/certificates/add`);
          this.table.setState({ currentItem: cert, showAddForm: true });
        });
      }
    });
  };

  importP12 = () => {
    const input = document.querySelector('input[type="file"]');
    const data = new FormData();
    data.append('file', input.files[0]);
    return window.newPrompt('Certificate password ?').then((password) => {
      if (password) {
        return BackOfficeServices.importP12(password, input.files[0]).then((cert) => {
          // this.table.update();
          this.props.setTitle(`Create a new certificate`);
          window.history.replaceState({}, '', `/bo/dashboard/certificates/add`);
          this.table.setState({ currentItem: cert, showAddForm: true });
        });
      }
    });
  };

  createLetsEncrypt = () => {
    window
      .popup(
        'New Certificate',
        (ok, cancel) => <NewCertificateForm ok={ok} cancel={cancel} letsEncrypt={true} />,
        { style: { width: '100%' } }
      )
      .then((form) => {
        if (form) {
          BackOfficeServices.createCertificateFromForm(form).then((cert) => {
            this.props.setTitle(`Create a new Certificate`);
            window.history.replaceState({}, '', `/bo/dashboard/certificates/add`);
            if (form.letsEncrypt) {
              this.table.setState({ currentItem: cert, showEditForm: true });
            } else {
              this.table.setState({ currentItem: cert, showAddForm: true });
            }
          });
        }
      });
    // window.newPrompt('Certificate domain').then(value => {
    //   if (value && value.trim() !== '') {
    //     if (value.indexOf('*') > -1 ) {
    //       window.newAlert('Domain name cannot contain * character')
    //     } else {
    //       window.newAlert(<LetsEncryptCreation
    //         domain={value}
    //         onCreated={(cert, setError) => {
    //           if (!cert.chain) {
    //             setError(`Error while creating let's encrypt certificate: ${cert.error}`)
    //           } else {
    //             this.props.setTitle(`Edit certificate`);
    //             window.history.replaceState({}, '', `/bo/dashboard/certificates/edit/${cert.id}`);
    //             this.table.setState({ currentItem: cert, showEditForm: true });
    //           }
    //         }} />, `Ordering certificate for ${value}`);
    //     }
    //   }
    // });
  };

  createCASigned = (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    window
      .popup(
        'New Certificate',
        (ok, cancel) => <NewCertificateForm ok={ok} cancel={cancel} caRef={id} />,
        { style: { width: '100%' } }
      )
      .then((form) => {
        if (form) {
          BackOfficeServices.createCertificateFromForm(form).then((cert) => {
            this.props.setTitle(`Create a new Certificate`);
            window.history.replaceState({}, '', `/bo/dashboard/certificates/add`);
            if (form.letsEncrypt) {
              this.table.setState({ currentItem: cert, showEditForm: true });
            } else {
              this.table.setState({ currentItem: cert, showAddForm: true });
            }
          });
        }
      });
    // window.newConfirm("Is certificate a client certificate ?").then(ok => {
    //   if (ok) {
    //     window.newPrompt('Certificate DN').then(value => {
    //       if (value && value.trim() !== '') {
    //         BackOfficeServices.caSignedClientCert(id, value).then(cert => {
    //           this.props.setTitle(`Create a new certificate`);
    //           window.history.replaceState({}, '', `/bo/dashboard/certificates/add`);
    //           this.table.setState({ currentItem: cert, showAddForm: true });
    //         });
    //       }
    //     });
    //   } else {
    //     window.newPrompt('Certificate hostname').then(value => {
    //       if (value && value.trim() !== '') {
    //         BackOfficeServices.caSignedCert(id, value).then(cert => {
    //           this.props.setTitle(`Create a new certificate`);
    //           window.history.replaceState({}, '', `/bo/dashboard/certificates/add`);
    //           this.table.setState({ currentItem: cert, showAddForm: true });
    //         });
    //       }
    //     });
    //   }
    // })
  };

  createCA = () => {
    window.newPrompt('Certificate Authority CN').then((value) => {
      if (value && value.trim() !== '') {
        BackOfficeServices.caCert(value).then((cert) => {
          this.props.setTitle(`Create a new Certificate Authority`);
          window.history.replaceState({}, '', `/bo/dashboard/certificates/add`);
          this.table.setState({ currentItem: cert, showAddForm: true });
        });
      }
    });
  };

  createCertificate = (e) => {
    e.preventDefault();
    window
      .popup('New Certificate', (ok, cancel) => <NewCertificateForm ok={ok} cancel={cancel} />, {
        style: { width: '100%' },
      })
      .then((form) => {
        if (form) {
          BackOfficeServices.createCertificateFromForm(form).then((cert) => {
            console.log(form);
            this.props.setTitle(`Create a new Certificate`);
            window.history.replaceState({}, '', `/bo/dashboard/certificates/add`);
            if (form.letsEncrypt) {
              this.table.setState({ currentItem: cert, showEditForm: true });
            } else {
              this.table.setState({ currentItem: cert, showAddForm: true });
            }
          });
        }
      });
  };

  render() {
    return (
      <Table
        parentProps={this.props}
        selfUrl="certificates"
        defaultTitle="All SSL/TLS certificates"
        defaultValue={() => ({ id: faker.random.alphaNumeric(64) })}
        _defaultValue={BackOfficeServices.createNewCertificate}
        itemName="certificate"
        formSchema={this.formSchema}
        formFlow={this.formFlow}
        columns={this.columns}
        stayAfterSave={true}
        fetchItems={BackOfficeServices.findAllCertificates}
        updateItem={BackOfficeServices.updateCertificate}
        deleteItem={BackOfficeServices.deleteCertificate}
        createItem={BackOfficeServices.createCertificate}
        navigateTo={(item) => {
          window.location = `/bo/dashboard/certificates/edit/${item.id}`;
        }}
        itemUrl={(i) => `/bo/dashboard/certificates/edit/${i.id}`}
        showActions={true}
        showLink={true}
        rowNavigation={true}
        extractKey={(item) => item.id}
        export={true}
        kubernetesKind="Certificate"
        injectTable={(table) => (this.table = table)}
        injectTopBar={() => (
          <>
            {/*<div className="btn__group" style={{ marginRight: 5 }}>
            <button
              type="button"
              onClick={this.createLetsEncrypt}
              style={{ marginRight: 0 }}
              className="btn-info">
              <i className="fas fa-plus-circle" /> Let's Encrypt cert.
            </button>
          </div>*/}
              <div className="mt-5 mb-5 btn__group">
              {/*<button
              type="button"
              onClick={this.createSelfSigned}
              style={{ marginRight: 0 }}
              className="btn-info">
              <i className="fas fa-plus-circle" /> Self signed cert.
            </button>
            <button
              type="button"
              onClick={this.createSelfSignedClient}
              style={{ marginRight: 0 }}
              className="btn-info">
              <i className="fas fa-plus-circle" /> Self signed client cert.
            </button>
            <button
              type="button"
              onClick={this.createCA}
              style={{ marginRight: 0 }}
              className="btn-info">
              <i className="fas fa-plus-circle" /> Self signed CA
            </button>*/}
              <button
                type="button"
                onClick={this.createLetsEncrypt}
                className="btn-info button mb-5">
                <i className="fas fa-plus-circle" /> Let's Encrypt Certificate
              </button>
              <button
                type="button"
                onClick={this.createCertificate}
                className="btn-info button mb-5">
                <i className="fas fa-plus-circle" /> Create Certificate
              </button>
              <input
                type="file"
                name="export"
                id="export"
                className="button btn-info mb-5"
                ref={(ref) => (this.fileUpload = ref)}
                style={{ display: 'none' }}
                onChange={this.importP12}
              />
              <button
                htmlFor="export"
                className="button btn-info mb-5">
                <i className="fas fa-file" /> Import .p12 file
              </button>
            </div>
          </>
        )}
      />
    );
  }
}

export class NewCertificateForm extends Component {
  state = {
    ca: this.props.ca || false,
    client: this.props.client || false,
    letsEncrypt: this.props.letsEncrypt || false,
    caRef: this.props.caRef || null,
    keyType: 'RSA',
    keySize: 2048,
    duration: 365,
    subject:
      this.props.subject || 'SN=Foo, OU=User Certificates, OU=Otoroshi Certificates, O=Otoroshi',
    host: this.props.host || 'www.foo.bar',
    hosts: this.props.host ? [this.props.host] : this.props.hosts || [],
    signatureAlg: 'SHA256WithRSAEncryption',
    digestAlg: 'SHA-256',
  };

  componentDidMount() {
    this.okRef.focus();
  }

  changeTheValue = (name, value) => {
    this.setState({ [name]: value });
  };

  csr = (e) => {
    BackOfficeServices.createCSR(this.state).then((csr) => {
      console.log('csr', csr);
      const url = URL.createObjectURL(
        new Blob([csr.csr], {
          type: 'application/x-pem-file',
        })
      );
      const a = document.createElement('a');
      a.setAttribute('href', url);
      a.setAttribute('download', 'csr.pem');
      a.click();
    });
  };

  render() {
    if (this.state.letsEncrypt) {
      return (
        <>
          <div className="modal-body">
            <form style={{ overflowY: 'auto' }}>
              <BooleanInput
                label="Let's Encrypt"
                value={this.state.letsEncrypt}
                onChange={(v) => this.changeTheValue('letsEncrypt', v)}
                help="Is your certificate a Let's Encrypt certificate"
              />
              <TextInput
                label="Host"
                value={this.state.host}
                onChange={(v) => this.changeTheValue('host', v)}
                help="The host of your certificate"
              />
            </form>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-danger mr-5" onClick={this.props.cancel}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-success"
              ref={(r) => (this.okRef = r)}
              onClick={(e) => this.props.ok(this.state)}>
              Create
            </button>
          </div>
        </>
      );
    }
    return (
      <>
        <div className="modal-body">
          <form  style={{ overflowY: 'auto', maxHeight: '80vh' }}>
            <SelectInput
              label="Issuer"
              value={this.state.caRef}
              onChange={(v) => this.changeTheValue('caRef', v)}
              help="The CA used to sign your certificate"
              placeholder="The CA used to sign your certificate"
              valuesFrom="/bo/api/proxy/api/certificates?ca=true"
              transformer={(a) => ({ value: a.id, label: a.name + ' - ' + a.description })}
            />
            <div>
              <div>
                {!this.state.client && (
                  <BiColumnBooleanInput
                    label="CA certificate"
                    value={this.state.ca}
                    onChange={(v) => this.changeTheValue('ca', v)}
                    help="Is your certificate a CA"
                  />
                )}
                {!this.state.ca && (
                  <BiColumnBooleanInput
                    label="Client certificate"
                    value={this.state.client}
                    onChange={(v) => this.changeTheValue('client', v)}
                    help="Is your certificate a client certificate"
                  />
                )}
              </div>
              <div>
                <BiColumnBooleanInput
                  label="Let's Encrypt"
                  value={this.state.letsEncrypt}
                  onChange={(v) => this.changeTheValue('letsEncrypt', v)}
                  help="Is your certificate a Let's Encrypt certificate"
                />
              </div>
            </div>
            <SelectInput
              label="Key Type"
              help="The type of the private key"
              value={this.state.keyType}
              onChange={(v) => changeTheValue('keyType', v)}
              possibleValues={[{ label: 'RSA', value: 'RSA' }]}
            />
            <SelectInput
              label="Key Size"
              help="The size of the private key"
              value={this.state.keySize}
              onChange={(v) => changeTheValue('keySize', v)}
              possibleValues={[
                { label: '1024', value: 1024 },
                { label: '2048', value: 2048 },
                { label: '4096', value: 4096 },
              ]}
            />
            <SelectInput
              label="Signature Algorithm"
              help="The signature algorithm used"
              value={this.state.signatureAlg}
              onChange={(v) => changeTheValue('signatureAlg', v)}
              possibleValues={[
                { label: 'SHA224WithRSAEncryption', value: 'SHA224WithRSAEncryption' },
                { label: 'SHA256WithRSAEncryption', value: 'SHA256WithRSAEncryption' },
                { label: 'SHA384WithRSAEncryption', value: 'SHA384WithRSAEncryption' },
                { label: 'SHA512WithRSAEncryption', value: 'SHA512WithRSAEncryption' },
              ]}
            />
            <SelectInput
              label="Digest Algorithm"
              help="The digest algorithm used"
              value={this.state.digestAlg}
              onChange={(v) => changeTheValue('digestAlg', v)}
              possibleValues={[
                { label: 'SHA-224', value: 'SHA-224' },
                { label: 'SHA-256', value: 'SHA-256' },
                { label: 'SHA-384', value: 'SHA-384' },
                { label: 'SHA-512', value: 'SHA-512' },
                { label: 'SHA-512-224', value: 'SHA-512-224' },
                { label: 'SHA-512-256', value: 'SHA-512-256' },
              ]}
            />
            <NumberInput
              label="Validity"
              value={this.state.duration}
              onChange={(v) => this.changeTheValue('duration', v)}
              help="How much time your certificate will be valid"
              suffix="days"
            />
            <TextInput
              label="Subject DN"
              value={this.state.subject}
              onChange={(v) => this.changeTheValue('subject', v)}
              help="The subject DN of your certificate"
            />
            {!this.state.ca && !this.state.client && (
              <ArrayInput
                label="Hosts"
                value={this.state.hosts}
                onChange={(v) => this.changeTheValue('hosts', v)}
                help="The hosts of your certificate"
              />
            )}
          </form>
        </div>
        <div className="modal-footer">
          {this.state.caRef && (
            <button type="button" className="btn-info mr-5" onClick={this.csr}>
              <i className="fas fa-file" /> Download CSR
            </button>
          )}
          <button type="button" className="btn-danger mr-5" onClick={this.props.cancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-success"
            ref={(r) => (this.okRef = r)}
            onClick={(e) => this.props.ok(this.state)}>
            Create
          </button>
        </div>
      </>
    );
  }
}

export class LetsEncryptCreation extends Component {
  state = { error: null, done: false };

  componentDidMount() {
    BackOfficeServices.letsEncryptCert(this.props.domain)
      .then((cert) => {
        this.setState({ done: true });
        setTimeout(() => {
          this.props.onCreated(cert, (e) => this.setState({ error: e }));
        }, 1000);
      })
      .catch((e) => {
        this.setState({ error: e.message ? e.message : e });
      });
  }

  render() {
    if (this.state.error) {
      return <span className="label bg__alert">{this.state.error}</span>;
    }
    if (this.state.done) {
      return (
        <span className="label bg__success">
          Certificate for {this.props.domain} created successfully !
        </span>
      );
    }
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          width: '100%',
          height: 300,
        }}>
        <svg
          width="142px"
          height="142px"
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid"
          className="uil-ring-alt">
          <rect x="0" y="0" width="100" height="100" fill="none" className="bk" />
          <circle cx="50" cy="50" r="40" stroke="#222222" fill="none" strokeLinecap="round" />
          <circle cx="50" cy="50" r="40" stroke="#f9b000" fill="none" strokeLinecap="round">
            <animate
              attributeName="stroke-dashoffset"
              dur="2s"
              repeatCount="indefinite"
              from="0"
              to="502"
            />
            <animate
              attributeName="stroke-dasharray"
              dur="2s"
              repeatCount="indefinite"
              values="150.6 100.4;1 250;150.6 100.4"
            />
          </circle>
        </svg>
      </div>
    );
  }
}
