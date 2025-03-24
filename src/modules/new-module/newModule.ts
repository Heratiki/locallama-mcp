import NewComponent from './newComponent.js';

class NewModule {
  private newComponent: NewComponent;

  constructor() {
    this.newComponent = new NewComponent();
  }

  public addDataToComponent(data: { id: string; [key: string]: string | number | boolean | null | undefined }): void {
    this.newComponent.addData(data);
  }

  public getDataFromComponent(): { id: string; [key: string]: string | number | boolean | null | undefined }[] {
    return this.newComponent.getData();
  }
}

export default NewModule;
